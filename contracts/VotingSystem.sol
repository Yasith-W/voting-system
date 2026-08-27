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

    /// @notice Cast a first-time vote before the deadline.
    /// @dev Reverts if the caller has already voted — use {changeVote} to update
    ///      an existing vote. Together with the `hasVoted` guard this enforces
    ///      "one address, one counted vote" while still allowing changes via a
    ///      separate, explicit function.
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
            !hasVoted[electionId][msg.sender],
            "VotingSystem: already voted - use changeVote to update your vote"
        );
        require(
            optionIndex < elections[electionId].options.length,
            "VotingSystem: invalid option index"
        );

        hasVoted[electionId][msg.sender] = true;
        voterChoice[electionId][msg.sender] = optionIndex;
        voteCounts[electionId][optionIndex] += 1;
        elections[electionId].totalVotesCast += 1;

        emit VoteCast(electionId, msg.sender, optionIndex, block.timestamp);
    }

    /// @notice Change a previously cast vote to a different option before the deadline.
    /// @dev Moves the caller's single counted vote from their previous option to
    ///      the new one — the tally never gains or loses a vote, it only shifts,
    ///      so "prevent duplicate voting" still holds. Reverts if the caller has
    ///      not yet voted (use {castVote} first) or if the deadline has passed.
    function changeVote(uint256 electionId, uint256 newOptionIndex)
        external
        electionExists(electionId)
        withinVotingPeriod(electionId)
    {
        require(
            eligibleVoters[electionId][msg.sender],
            "VotingSystem: address is not eligible to vote in this election"
        );
        require(
            hasVoted[electionId][msg.sender],
            "VotingSystem: no vote to change - use castVote first"
        );
        require(
            newOptionIndex < elections[electionId].options.length,
            "VotingSystem: invalid option index"
        );

        uint256 previousChoice = voterChoice[electionId][msg.sender];
        require(previousChoice != newOptionIndex, "VotingSystem: already voted for this option");

        voteCounts[electionId][previousChoice] -= 1;
        voteCounts[electionId][newOptionIndex] += 1;
        voterChoice[electionId][msg.sender] = newOptionIndex;

        emit VoteChanged(electionId, msg.sender, previousChoice, newOptionIndex, block.timestamp);
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

    /// @notice The current leading option for an election, computed on-chain.
    /// @dev O(number of options), which is small and fixed per election, so this
    ///      stays cheap regardless of turnout. Callable at any time — while voting
    ///      is open it reports the current leader; after the deadline it is the
    ///      final result. `tie` is true when two or more options that have
    ///      received at least one vote share the top count.
    /// @return winningIndex Index of the leading option (0 when no votes yet).
    /// @return winningLabel Label of the leading option.
    /// @return winningVotes Vote count of the leading option (0 when no votes yet).
    /// @return tie True if the top count is shared by more than one option.
    function getWinningOption(uint256 electionId)
        external
        view
        electionExists(electionId)
        returns (uint256 winningIndex, string memory winningLabel, uint256 winningVotes, bool tie)
    {
        Election storage e = elections[electionId];
        uint256 optionCount = e.options.length;
        for (uint256 i = 0; i < optionCount; i++) {
            uint256 c = voteCounts[electionId][i];
            if (c > winningVotes) {
                winningVotes = c;
                winningIndex = i;
                tie = false;
            } else if (c == winningVotes && c != 0) {
                tie = true;
            }
        }
        winningLabel = e.options[winningIndex];
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
