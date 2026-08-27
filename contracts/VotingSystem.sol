// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title VotingSystem
/// @notice Voting contract for DAS5003 PRAC1 (Section 3, Option B). Organisers
///         create elections, whitelisted addresses vote once and can change
///         their vote until the deadline, and the contract keeps the tally.
/// @dev Design notes:
///      - Access control: Ownable for the owner, plus an organiser whitelist
///        so it isn't a single admin key.
///      - No external calls and no funds held, so re-entrancy isn't a concern.
///      - The tally lives in a mapping and is updated per vote, so gas cost
///        doesn't grow with the number of voters.
contract VotingSystem is Ownable {
    struct Election {
        string title;
        string[] options;
        uint256 startTime;
        uint256 endTime;
        address organiser;
        uint256 totalVotesCast; // how many addresses have voted
        bool exists;
    }

    mapping(uint256 => Election) private elections;
    uint256 public electionCount;

    // electionId => voter => ...
    mapping(uint256 => mapping(address => bool)) private eligibleVoters;
    mapping(uint256 => mapping(address => bool)) private hasVoted;
    mapping(uint256 => mapping(address => uint256)) private voterChoice; // only valid if hasVoted
    // electionId => option index => count
    mapping(uint256 => mapping(uint256 => uint256)) private voteCounts;

    // addresses allowed to create elections (as well as the owner)
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
        // whoever deploys is the first organiser
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
    // Organiser management
    // ----------------------------------------------------------------------

    /// @notice Let an address create elections.
    function authorizeOrganiser(address organiser) external onlyOwner {
        require(organiser != address(0), "VotingSystem: zero address");
        authorisedOrganisers[organiser] = true;
        emit OrganiserAuthorized(organiser);
    }

    /// @notice Stop an address from creating elections.
    function revokeOrganiser(address organiser) external onlyOwner {
        authorisedOrganisers[organiser] = false;
        emit OrganiserRevoked(organiser);
    }

    // ----------------------------------------------------------------------
    // Election lifecycle
    // ----------------------------------------------------------------------

    /// @notice Create an election. Needs at least two options and an end time
    ///         in the future. Times are Unix timestamps.
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

    /// @notice Add one address to an election's voter whitelist.
    function registerVoter(uint256 electionId, address voter)
        public
        electionExists(electionId)
        onlyElectionOrganiser(electionId)
    {
        require(voter != address(0), "VotingSystem: zero address");
        eligibleVoters[electionId][voter] = true;
        emit VoterRegistered(electionId, voter);
    }

    /// @notice Add several addresses to the whitelist in one transaction.
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

    /// @notice Cast your vote. Reverts if you've already voted; use changeVote
    ///         to switch. One address only ever counts for one vote.
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

    /// @notice Move your vote to a different option. Reverts if you haven't
    ///         voted yet, or if voting has closed. The tally just shifts by
    ///         one, so your address still only counts once.
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
    // Read-only views
    // ----------------------------------------------------------------------

    /// @notice Details of an election.
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

    /// @notice Option labels and their current vote counts, in the same order.
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

    /// @notice The option in the lead. While voting is open this is the running
    ///         leader; after the deadline it's the final result.
    /// @return winningIndex  index of the top option (0 if nobody has voted)
    /// @return winningLabel  its label
    /// @return winningVotes  its vote count
    /// @return tie           true if two or more options are tied at the top
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

    /// @notice Which option an address voted for. Reverts if it hasn't voted,
    ///         so check hasAddressVoted first.
    function getVoterChoice(uint256 electionId, address voter) external view returns (uint256) {
        require(hasVoted[electionId][voter], "VotingSystem: address has not voted");
        return voterChoice[electionId][voter];
    }

    function isVotingOpen(uint256 electionId) external view electionExists(electionId) returns (bool) {
        Election storage e = elections[electionId];
        return block.timestamp >= e.startTime && block.timestamp <= e.endTime;
    }
}
