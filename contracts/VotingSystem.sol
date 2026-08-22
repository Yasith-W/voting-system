// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title VotingSystem — a decentralized voting and governance DApp
/// @notice Implements the DAS5003 PRAC1 Section 3 Option B brief:
///         authorized election creation, verified (whitelisted) voting,
///         one-address-one-vote with edits allowed before the deadline,
///         an immutable on-chain activity log, and automatic result tallying.
/// @dev Security notes (discussed further in the technical report):
///      - Access control uses OpenZeppelin's Ownable plus a per-address
///        organiser whitelist, rather than a single hardcoded admin.
///      - All state changes happen before any (non-existent, here) external
///        calls, following checks-effects-interactions; the contract holds
///        no funds and makes no external calls, so re-entrancy is not a
///        practical risk in this version.
///      - Iteration over unbounded arrays is avoided in write paths: vote
///        tallies are maintained incrementally in a mapping rather than by
///        looping over all votes, keeping gas cost constant regardless of
///        turnout.
contract VotingSystem is Ownable {
    struct Election {
        string title;
        string[] options;
        uint256 startTime;
        uint256 endTime;
        address organiser;
        uint256 totalVotesCast; // number of distinct voters who have voted
        bool exists;
    }

    /// @dev electionId => Election
    mapping(uint256 => Election) private elections;
    uint256 public electionCount;

    /// @dev electionId => voter => eligible to vote
    mapping(uint256 => mapping(address => bool)) private eligibleVoters;
    /// @dev electionId => voter => has cast a vote
    mapping(uint256 => mapping(address => bool)) private hasVoted;
    /// @dev electionId => voter => chosen option index (only meaningful if hasVoted)
    mapping(uint256 => mapping(address => uint256)) private voterChoice;
    /// @dev electionId => optionIndex => vote count
    mapping(uint256 => mapping(uint256 => uint256)) private voteCounts;

    /// @dev addresses allowed to create elections, in addition to the contract owner
    mapping(address => bool) public authorisedOrganisers;

    event OrganiserAuthorized(address indexed organiser);
    event OrganiserRevoked(address indexed organiser);
    event ElectionCreated(
        uint256 indexed electionId,
        string title,
        address indexed organiser,
        uint256 startTime,
        uint256 endTime
    );
    event VoterRegistered(uint256 indexed electionId, address indexed voter);
    event VoteCast(
        uint256 indexed electionId,
        address indexed voter,
        uint256 optionIndex,
        uint256 timestamp
    );
    event VoteChanged(
        uint256 indexed electionId,
        address indexed voter,
        uint256 previousOptionIndex,
        uint256 newOptionIndex,
        uint256 timestamp
    );

    constructor() Ownable(msg.sender) {
        authorisedOrganisers[msg.sender] = true;
        emit OrganiserAuthorized(msg.sender);
    }

    // ----------------------------------------------------------------------
    // Modifiers
    // ----------------------------------------------------------------------

    modifier onlyAuthorisedOrganiser() {
        require(
            authorisedOrganisers[msg.sender],
            "VotingSystem: caller is not an authorised organiser"
        );
        _;
    }

    modifier electionExists(uint256 electionId) {
        require(elections[electionId].exists, "VotingSystem: election does not exist");
        _;
    }

    modifier onlyElectionOrganiser(uint256 electionId) {
        require(
            elections[electionId].organiser == msg.sender,
            "VotingSystem: caller is not this election's organiser"
        );
        _;
    }

    modifier withinVotingPeriod(uint256 electionId) {
        Election storage e = elections[electionId];
        require(block.timestamp >= e.startTime, "VotingSystem: voting has not started yet");
        require(block.timestamp <= e.endTime, "VotingSystem: voting deadline has passed");
        _;
    }

    // ----------------------------------------------------------------------
    // Organiser management (LO2/LO6: access control & trust without a central admin)
    // ----------------------------------------------------------------------

    /// @notice Grant an address permission to create elections.
    function authorizeOrganiser(address organiser) external onlyOwner {
        require(organiser != address(0), "VotingSystem: zero address");
        authorisedOrganisers[organiser] = true;
        emit OrganiserAuthorized(organiser);
    }

    /// @notice Revoke an address's permission to create elections.
    function revokeOrganiser(address organiser) external onlyOwner {
        authorisedOrganisers[organiser] = false;
        emit OrganiserRevoked(organiser);
    }

    // ----------------------------------------------------------------------
    // Election lifecycle
    // ----------------------------------------------------------------------

    /// @notice Create a new election / voting campaign.
    /// @param title Human-readable election title.
    /// @param options The candidate/choice list voters can pick from (min 2).
    /// @param startTime Unix timestamp when voting opens.
    /// @param endTime Unix timestamp when voting closes (must be after startTime).
    /// @return electionId The id assigned to the new election.
    function createElection(
        string calldata title,
        string[] calldata options,
        uint256 startTime,
        uint256 endTime
    ) external onlyAuthorisedOrganiser returns (uint256 electionId) {
        require(bytes(title).length > 0, "VotingSystem: title required");
        require(options.length >= 2, "VotingSystem: need at least two options");
        require(endTime > startTime, "VotingSystem: endTime must be after startTime");
        require(endTime > block.timestamp, "VotingSystem: endTime must be in the future");

        electionId = electionCount;
        Election storage e = elections[electionId];
        e.title = title;
        e.startTime = startTime;
        e.endTime = endTime;
        e.organiser = msg.sender;
        e.exists = true;
        for (uint256 i = 0; i < options.length; i++) {
            e.options.push(options[i]);
        }

        electionCount++;

        emit ElectionCreated(electionId, title, msg.sender, startTime, endTime);
    }

    /// @notice Whitelist a single voter address as eligible for an election.
    function registerVoter(uint256 electionId, address voter)
        public
        electionExists(electionId)
        onlyElectionOrganiser(electionId)
    {
        require(voter != address(0), "VotingSystem: zero address");
        eligibleVoters[electionId][voter] = true;
        emit VoterRegistered(electionId, voter);
    }

    /// @notice Whitelist multiple voter addresses in one transaction.
    function registerVoters(uint256 electionId, address[] calldata voters)
        external
        electionExists(electionId)
        onlyElectionOrganiser(electionId)
    {
        for (uint256 i = 0; i < voters.length; i++) {
            registerVoter(electionId, voters[i]);
        }
    }

    // ----------------------------------------------------------------------
    // Voting
    // ----------------------------------------------------------------------

    /// @notice Cast a vote, or change a previously cast vote, before the deadline.
    /// @dev One address can only ever hold ONE counted vote per election —
    ///      calling this again before the deadline moves that single vote
    ///      to the new option rather than adding a second one, satisfying
    ///      both "prevent duplicate voting" and "allow voters to change
    ///      their vote before the deadline".
    function castVote(uint256 electionId, uint256 optionIndex)
        external
        electionExists(electionId)
        withinVotingPeriod(electionId)
    {
        require(
            eligibleVoters[electionId][msg.sender],
            "VotingSystem: address is not eligible to vote in this election"
        );
        require(
            optionIndex < elections[electionId].options.length,
            "VotingSystem: invalid option index"
        );

        if (!hasVoted[electionId][msg.sender]) {
            hasVoted[electionId][msg.sender] = true;
            voterChoice[electionId][msg.sender] = optionIndex;
            voteCounts[electionId][optionIndex] += 1;
            elections[electionId].totalVotesCast += 1;

            emit VoteCast(electionId, msg.sender, optionIndex, block.timestamp);
        } else {
            uint256 previousChoice = voterChoice[electionId][msg.sender];
            require(previousChoice != optionIndex, "VotingSystem: already voted for this option");

            voteCounts[electionId][previousChoice] -= 1;
            voteCounts[electionId][optionIndex] += 1;
            voterChoice[electionId][msg.sender] = optionIndex;

            emit VoteChanged(electionId, msg.sender, previousChoice, optionIndex, block.timestamp);
        }
    }

    // ----------------------------------------------------------------------
    // Read / transparency & auditability
    // ----------------------------------------------------------------------

    function getElection(uint256 electionId)
        external
        view
        electionExists(electionId)
        returns (
            string memory title,
            string[] memory options,
            uint256 startTime,
            uint256 endTime,
            address organiser,
            uint256 totalVotesCast
        )
    {
        Election storage e = elections[electionId];
        return (e.title, e.options, e.startTime, e.endTime, e.organiser, e.totalVotesCast);
    }

    /// @notice Automatically-tallied results for every option in an election.
    /// @return options The option labels.
    /// @return counts The current vote count for each option, in the same order.
    function getResults(uint256 electionId)
        external
        view
        electionExists(electionId)
        returns (string[] memory options, uint256[] memory counts)
    {
        Election storage e = elections[electionId];
        options = e.options;
        counts = new uint256[](e.options.length);
        for (uint256 i = 0; i < e.options.length; i++) {
            counts[i] = voteCounts[electionId][i];
        }
    }

    function isEligible(uint256 electionId, address voter) external view returns (bool) {
        return eligibleVoters[electionId][voter];
    }

    function hasAddressVoted(uint256 electionId, address voter) external view returns (bool) {
        return hasVoted[electionId][voter];
    }

    /// @notice The option a given address currently has recorded, for audit purposes.
    /// @dev Reverts if the address has not voted, so callers should check
    ///      hasAddressVoted first.
    function getVoterChoice(uint256 electionId, address voter) external view returns (uint256) {
        require(hasVoted[electionId][voter], "VotingSystem: address has not voted");
        return voterChoice[electionId][voter];
    }

    function isVotingOpen(uint256 electionId) external view electionExists(electionId) returns (bool) {
        Election storage e = elections[electionId];
        return block.timestamp >= e.startTime && block.timestamp <= e.endTime;
    }
}
