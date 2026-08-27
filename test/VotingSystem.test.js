const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("VotingSystem", function () {
  let voting;
  let owner, organiser, outsider, alice, bob, carol, unregistered;

  beforeEach(async function () {
    [owner, organiser, outsider, alice, bob, carol, unregistered] =
      await ethers.getSigners();

    const VotingSystem = await ethers.getContractFactory("VotingSystem");
    voting = await VotingSystem.deploy();
    await voting.waitForDeployment();
  });

  async function createStandardElection(signer = owner, offsetStart = 0, durationSecs = 3600) {
    const start = (await time.latest()) + offsetStart;
    const end = start + durationSecs;
    const tx = await voting
      .connect(signer)
      .createElection("Class Rep Election", ["Alice", "Bob", "Carol"], start, end);
    await tx.wait();
    return { electionId: 0, start, end };
  }

  describe("Organiser authorisation", function () {
    it("sets the deployer as an authorised organiser by default", async function () {
      expect(await voting.authorisedOrganisers(owner.address)).to.equal(true);
    });

    it("lets the owner authorise a new organiser", async function () {
      await expect(voting.authorizeOrganiser(organiser.address))
        .to.emit(voting, "OrganiserAuthorized")
        .withArgs(organiser.address);

      expect(await voting.authorisedOrganisers(organiser.address)).to.equal(true);
    });

    it("lets the owner revoke an organiser", async function () {
      await voting.authorizeOrganiser(organiser.address);
      await expect(voting.revokeOrganiser(organiser.address))
        .to.emit(voting, "OrganiserRevoked")
        .withArgs(organiser.address);

      expect(await voting.authorisedOrganisers(organiser.address)).to.equal(false);
    });

    it("reverts when a non-owner tries to authorise an organiser", async function () {
      await expect(
        voting.connect(outsider).authorizeOrganiser(organiser.address)
      ).to.be.revertedWithCustomError(voting, "OwnableUnauthorizedAccount");
    });
  });

  describe("Creating elections", function () {
    it("allows an authorised organiser to create an election", async function () {
      const start = (await time.latest()) + 10;
      const end = start + 3600;

      await expect(
        voting.createElection("Class Rep Election", ["Alice", "Bob", "Carol"], start, end)
      )
        .to.emit(voting, "ElectionCreated")
        .withArgs(0, "Class Rep Election", owner.address, start, end);

      expect(await voting.electionCount()).to.equal(1);
    });

    it("rejects election creation from an address that is not an authorised organiser", async function () {
      const start = (await time.latest()) + 10;
      const end = start + 3600;

      await expect(
        voting.connect(outsider).createElection("Rogue Election", ["A", "B"], start, end)
      ).to.be.revertedWith("VotingSystem: caller is not an authorised organiser");
    });

    it("rejects an election with fewer than two options", async function () {
      const start = (await time.latest()) + 10;
      const end = start + 3600;

      await expect(
        voting.createElection("Bad Election", ["OnlyOption"], start, end)
      ).to.be.revertedWith("VotingSystem: need at least two options");
    });

    it("rejects an election whose end time is not after its start time", async function () {
      const start = (await time.latest()) + 100;
      await expect(
        voting.createElection("Bad Election", ["A", "B"], start, start)
      ).to.be.revertedWith("VotingSystem: endTime must be after startTime");
    });
  });

  describe("Voter registration", function () {
    it("lets the election's organiser register a voter", async function () {
      await createStandardElection();

      await expect(voting.registerVoter(0, alice.address))
        .to.emit(voting, "VoterRegistered")
        .withArgs(0, alice.address);

      expect(await voting.isEligible(0, alice.address)).to.equal(true);
    });

    it("supports batch registration", async function () {
      await createStandardElection();

      await voting.registerVoters(0, [alice.address, bob.address, carol.address]);

      expect(await voting.isEligible(0, alice.address)).to.equal(true);
      expect(await voting.isEligible(0, bob.address)).to.equal(true);
      expect(await voting.isEligible(0, carol.address)).to.equal(true);
    });

    it("rejects registration from someone other than that election's organiser", async function () {
      await createStandardElection();

      await expect(
        voting.connect(outsider).registerVoter(0, alice.address)
      ).to.be.revertedWith("VotingSystem: caller is not this election's organiser");
    });

    it("reverts when registering a voter for a non-existent election", async function () {
      await expect(voting.registerVoter(99, alice.address)).to.be.revertedWith(
        "VotingSystem: election does not exist"
      );
    });
  });

  describe("Casting and changing votes", function () {
    beforeEach(async function () {
      await createStandardElection(owner, 0, 3600);
      await voting.registerVoters(0, [alice.address, bob.address, carol.address]);
    });

    it("records a first-time vote and emits VoteCast", async function () {
      await expect(voting.connect(alice).castVote(0, 1))
        .to.emit(voting, "VoteCast")
        .withArgs(0, alice.address, 1, anyValue);

      expect(await voting.hasAddressVoted(0, alice.address)).to.equal(true);
      expect(await voting.getVoterChoice(0, alice.address)).to.equal(1);

      const [, counts] = await voting.getResults(0);
      expect(counts[1]).to.equal(1);
    });

    it("prevents an address that is not whitelisted from voting", async function () {
      await expect(
        voting.connect(unregistered).castVote(0, 0)
      ).to.be.revertedWith("VotingSystem: address is not eligible to vote in this election");
    });

    it("rejects a second castVote from the same address (must use changeVote)", async function () {
      await voting.connect(alice).castVote(0, 0);
      await expect(voting.connect(alice).castVote(0, 2)).to.be.revertedWith(
        "VotingSystem: already voted - use changeVote to update your vote"
      );
    });

    it("prevents duplicate voting from counting twice — changeVote just moves the vote", async function () {
      await voting.connect(alice).castVote(0, 0); // votes for "Alice"
      await voting.connect(alice).changeVote(0, 2); // changes to "Carol"

      const [, counts] = await voting.getResults(0);
      expect(counts[0]).to.equal(0); // moved away from option 0
      expect(counts[2]).to.equal(1); // now counted under option 2

      const totalVotes = counts.reduce((a, b) => a + b, 0n);
      expect(totalVotes).to.equal(1n); // still only ONE counted vote for alice
    });

    it("emits VoteChanged when a voter updates their choice", async function () {
      await voting.connect(alice).castVote(0, 0);

      await expect(voting.connect(alice).changeVote(0, 1))
        .to.emit(voting, "VoteChanged")
        .withArgs(0, alice.address, 0, 1, anyValue);
    });

    it("rejects changeVote before the address has cast a vote", async function () {
      await expect(voting.connect(alice).changeVote(0, 1)).to.be.revertedWith(
        "VotingSystem: no vote to change - use castVote first"
      );
    });

    it("rejects changeVote to the option the voter already holds", async function () {
      await voting.connect(alice).castVote(0, 0);
      await expect(voting.connect(alice).changeVote(0, 0)).to.be.revertedWith(
        "VotingSystem: already voted for this option"
      );
    });

    it("rejects changeVote from an address that is not whitelisted", async function () {
      await expect(voting.connect(unregistered).changeVote(0, 0)).to.be.revertedWith(
        "VotingSystem: address is not eligible to vote in this election"
      );
    });

    it("rejects an out-of-range option index on castVote and changeVote", async function () {
      await expect(voting.connect(alice).castVote(0, 99)).to.be.revertedWith(
        "VotingSystem: invalid option index"
      );
      await voting.connect(alice).castVote(0, 0);
      await expect(voting.connect(alice).changeVote(0, 99)).to.be.revertedWith(
        "VotingSystem: invalid option index"
      );
    });

    it("rejects votes cast before the election has started", async function () {
      const start = (await time.latest()) + 1000;
      const end = start + 3600;
      await voting.createElection("Future Election", ["A", "B"], start, end);
      await voting.registerVoter(1, alice.address);

      await expect(voting.connect(alice).castVote(1, 0)).to.be.revertedWith(
        "VotingSystem: voting has not started yet"
      );
    });

    it("rejects votes and vote changes after the deadline has passed", async function () {
      await voting.connect(alice).castVote(0, 0);

      await time.increase(3601); // move past the 1-hour election window

      await expect(voting.connect(bob).castVote(0, 1)).to.be.revertedWith(
        "VotingSystem: voting deadline has passed"
      );
      await expect(voting.connect(alice).changeVote(0, 1)).to.be.revertedWith(
        "VotingSystem: voting deadline has passed"
      );
    });
  });

  describe("Results, transparency and auditability", function () {
    beforeEach(async function () {
      await createStandardElection(owner, 0, 3600);
      await voting.registerVoters(0, [alice.address, bob.address, carol.address]);
    });

    it("automatically tallies results across multiple voters", async function () {
      await voting.connect(alice).castVote(0, 0);
      await voting.connect(bob).castVote(0, 0);
      await voting.connect(carol).castVote(0, 2);

      const [options, counts] = await voting.getResults(0);
      expect(options).to.deep.equal(["Alice", "Bob", "Carol"]);
      expect(counts[0]).to.equal(2);
      expect(counts[1]).to.equal(0);
      expect(counts[2]).to.equal(1);
    });

    it("exposes full election details for auditability", async function () {
      const [title, options, , , organiserAddr] = await voting.getElection(0);
      expect(title).to.equal("Class Rep Election");
      expect(options.length).to.equal(3);
      expect(organiserAddr).to.equal(owner.address);
    });

    it("reverts getVoterChoice for an address that has not voted", async function () {
      await expect(voting.getVoterChoice(0, alice.address)).to.be.revertedWith(
        "VotingSystem: address has not voted"
      );
    });

    it("reports whether voting is currently open", async function () {
      expect(await voting.isVotingOpen(0)).to.equal(true);
      await time.increase(3601);
      expect(await voting.isVotingOpen(0)).to.equal(false);
    });
  });

  describe("On-chain winner calculation (getWinningOption)", function () {
    beforeEach(async function () {
      await createStandardElection(owner, 0, 3600);
      await voting.registerVoters(0, [alice.address, bob.address, carol.address]);
    });

    it("reports no winner before any votes are cast", async function () {
      const [index, label, votes, tie] = await voting.getWinningOption(0);
      expect(index).to.equal(0);
      expect(label).to.equal("Alice");
      expect(votes).to.equal(0);
      expect(tie).to.equal(false);
    });

    it("identifies a clear winner", async function () {
      await voting.connect(alice).castVote(0, 2);
      await voting.connect(bob).castVote(0, 2);
      await voting.connect(carol).castVote(0, 0);

      const [index, label, votes, tie] = await voting.getWinningOption(0);
      expect(index).to.equal(2);
      expect(label).to.equal("Carol");
      expect(votes).to.equal(2);
      expect(tie).to.equal(false);
    });

    it("flags a tie between options that share the top count", async function () {
      await voting.connect(alice).castVote(0, 0);
      await voting.connect(bob).castVote(0, 1);

      const [, , votes, tie] = await voting.getWinningOption(0);
      expect(votes).to.equal(1);
      expect(tie).to.equal(true);
    });

    it("clears the tie flag once one option pulls ahead", async function () {
      await voting.connect(alice).castVote(0, 0);
      await voting.connect(bob).castVote(0, 1);
      await voting.connect(carol).castVote(0, 1);

      const [index, , votes, tie] = await voting.getWinningOption(0);
      expect(index).to.equal(1);
      expect(votes).to.equal(2);
      expect(tie).to.equal(false);
    });

    it("tracks the winner updating after a changeVote", async function () {
      await voting.connect(alice).castVote(0, 0);
      await voting.connect(bob).castVote(0, 0);
      await voting.connect(carol).castVote(0, 1);
      // option 0 leads 2-1, then alice switches and option 1 goes ahead
      await voting.connect(alice).changeVote(0, 1);

      const [index, , votes, tie] = await voting.getWinningOption(0);
      expect(index).to.equal(1);
      expect(votes).to.equal(2);
      expect(tie).to.equal(false);
    });

    it("reverts for a non-existent election", async function () {
      await expect(voting.getWinningOption(99)).to.be.revertedWith(
        "VotingSystem: election does not exist"
      );
    });
  });
});
