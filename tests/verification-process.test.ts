// VerificationProcess.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface Sighting {
  informant: string;
  evidenceHash: Buffer;
  status: string;
  votesFor: number;
  votesAgainst: number;
  totalVotes: number;
  deadline: number;
  verificationTimestamp?: number;
  location?: { lat: number; long: number };
  species: string;
}

interface ValidatorVote {
  vote: boolean;
  timestamp: number;
}

interface ContractState {
  paused: boolean;
  admin: string;
  sightingCounter: number;
  requiredQuorum: number;
  voteWindowBlocks: number;
  disputeWindowBlocks: number;
  sightings: Map<number, Sighting>;
  validatorVotes: Map<string, ValidatorVote>; // Key: `${sightingId}-${validator}`
  blockHeight: number;
  validators: Set<string>; // Mock for ValidatorRegistry
}

// Mock contract implementation
class VerificationProcessMock {
  private state: ContractState = {
    paused: false,
    admin: "deployer",
    sightingCounter: 0,
    requiredQuorum: 3,
    voteWindowBlocks: 144,
    disputeWindowBlocks: 72,
    sightings: new Map(),
    validatorVotes: new Map(),
    blockHeight: 1000,
    validators: new Set(["validator1", "validator2", "validator3", "validator4", "validator5"]),
  };

  private ERR_NOT_AUTHORIZED = 100;
  private ERR_SIGHTING_NOT_FOUND = 101;
  private ERR_VOTING_CLOSED = 102;
  private ERR_ALREADY_VOTED = 103;
  private ERR_INVALID_STATUS = 105;
  private ERR_CONTRACT_PAUSED = 107;
  private ERR_DISPUTE_WINDOW_CLOSED = 110;

  // Mock block-height increment for testing
  advanceBlockHeight(blocks: number) {
    this.state.blockHeight += blocks;
  }

  // Mock external calls
  private isRegisteredValidator(user: string): ClarityResponse<boolean> {
    return { ok: true, value: this.state.validators.has(user) };
  }

  private distributeReward(sightingId: number, informant: string): ClarityResponse<boolean> {
    // Mock success
    return { ok: true, value: true };
  }

  private initiateDispute(sightingId: number, disputant: string, reason: Buffer): ClarityResponse<boolean> {
    // Mock success
    return { ok: true, value: true };
  }

  startVerification(
    caller: string,
    informant: string,
    evidenceHash: Buffer,
    species: string,
    location?: { lat: number; long: number }
  ): ClarityResponse<number> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_CONTRACT_PAUSED };
    }
    const newId = this.state.sightingCounter + 1;
    this.state.sightings.set(newId, {
      informant,
      evidenceHash,
      status: "Pending",
      votesFor: 0,
      votesAgainst: 0,
      totalVotes: 0,
      deadline: this.state.blockHeight + this.state.voteWindowBlocks,
      location,
      species,
    });
    this.state.sightingCounter = newId;
    return { ok: true, value: newId };
  }

  voteOnSighting(
    caller: string,
    sightingId: number,
    approve: boolean,
    comment?: string
  ): ClarityResponse<boolean> {
    const sighting = this.state.sightings.get(sightingId);
    if (!sighting) {
      return { ok: false, value: this.ERR_SIGHTING_NOT_FOUND };
    }
    if (this.state.paused) {
      return { ok: false, value: this.ERR_CONTRACT_PAUSED };
    }
    if (!this.isRegisteredValidator(caller).value) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    if (sighting.status !== "Pending") {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }
    if (this.state.blockHeight >= sighting.deadline) {
      return { ok: false, value: this.ERR_VOTING_CLOSED };
    }
    const voteKey = `${sightingId}-${caller}`;
    if (this.state.validatorVotes.has(voteKey)) {
      return { ok: false, value: this.ERR_ALREADY_VOTED };
    }
    this.state.validatorVotes.set(voteKey, { vote: approve, timestamp: this.state.blockHeight });
    if (approve) {
      sighting.votesFor += 1;
    } else {
      sighting.votesAgainst += 1;
    }
    sighting.totalVotes += 1;
    // Check status
    this.checkVerificationStatus(sightingId);
    return { ok: true, value: true };
  }

  private checkVerificationStatus(sightingId: number): string {
    const sighting = this.state.sightings.get(sightingId)!;
    if (sighting.votesFor >= this.state.requiredQuorum) {
      sighting.status = "Approved";
      sighting.verificationTimestamp = this.state.blockHeight;
      this.distributeReward(sightingId, sighting.informant);
      return "Approved";
    } else if (sighting.votesAgainst >= this.state.requiredQuorum) {
      sighting.status = "Rejected";
      return "Rejected";
    } else if (this.state.blockHeight > sighting.deadline && sighting.totalVotes >= 5) {
      if (sighting.votesFor > sighting.votesAgainst) {
        sighting.status = "Approved";
        sighting.verificationTimestamp = this.state.blockHeight;
        this.distributeReward(sightingId, sighting.informant);
        return "Auto-Approved";
      } else {
        sighting.status = "Rejected";
        return "Auto-Rejected";
      }
    }
    return "Pending";
  }

  initiateDispute(
    caller: string,
    sightingId: number,
    reason: Buffer
  ): ClarityResponse<boolean> {
    const sighting = this.state.sightings.get(sightingId);
    if (!sighting) {
      return { ok: false, value: this.ERR_SIGHTING_NOT_FOUND };
    }
    if (this.state.paused) {
      return { ok: false, value: this.ERR_CONTRACT_PAUSED };
    }
    if (sighting.status !== "Approved" && sighting.status !== "Rejected") {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }
    if (!sighting.verificationTimestamp) {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }
    if (this.state.blockHeight >= sighting.verificationTimestamp + this.state.disputeWindowBlocks) {
      return { ok: false, value: this.ERR_DISPUTE_WINDOW_CLOSED };
    }
    this.initiateDispute(sightingId, caller, reason);
    sighting.status = "Disputed";
    return { ok: true, value: true };
  }

  pauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.paused = true;
    return { ok: true, value: true };
  }

  unpauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.paused = false;
    return { ok: true, value: true };
  }

  getSightingDetails(sightingId: number): ClarityResponse<Sighting | null> {
    return { ok: true, value: this.state.sightings.get(sightingId) ?? null };
  }

  getValidatorVote(sightingId: number, validator: string): ClarityResponse<ValidatorVote | null> {
    const voteKey = `${sightingId}-${validator}`;
    return { ok: true, value: this.state.validatorVotes.get(voteKey) ?? null };
  }

  canDispute(sightingId: number): ClarityResponse<boolean> {
    const sighting = this.state.sightings.get(sightingId);
    if (!sighting || (sighting.status !== "Approved" && sighting.status !== "Rejected") || !sighting.verificationTimestamp) {
      return { ok: true, value: false };
    }
    const can = this.state.blockHeight < sighting.verificationTimestamp + this.state.disputeWindowBlocks;
    return { ok: true, value: can };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  informant: "informant1",
  validator1: "validator1",
  validator2: "validator2",
  validator3: "validator3",
  nonValidator: "user1",
};

const mockEvidenceHash = Buffer.from("mockhash123456789012345678901234");

describe("VerificationProcess Contract", () => {
  let contract: VerificationProcessMock;

  beforeEach(() => {
    contract = new VerificationProcessMock();
    vi.resetAllMocks();
  });

  it("should start a new verification process", () => {
    const result = contract.startVerification(
      accounts.deployer,
      accounts.informant,
      mockEvidenceHash,
      "Elephant",
      { lat: 10, long: 20 }
    );
    expect(result).toEqual({ ok: true, value: 1 });
    const details = contract.getSightingDetails(1);
    expect(details.value).toEqual(expect.objectContaining({
      informant: accounts.informant,
      status: "Pending",
      votesFor: 0,
      votesAgainst: 0,
      totalVotes: 0,
      species: "Elephant",
      location: { lat: 10, long: 20 },
    }));
  });

  it("should prevent starting verification when paused", () => {
    contract.pauseContract(accounts.deployer);
    const result = contract.startVerification(
      accounts.deployer,
      accounts.informant,
      mockEvidenceHash,
      "Elephant"
    );
    expect(result).toEqual({ ok: false, value: 107 });
  });

  it("should allow validators to vote and reach approval quorum", () => {
    contract.startVerification(
      accounts.deployer,
      accounts.informant,
      mockEvidenceHash,
      "Elephant"
    );
    contract.voteOnSighting(accounts.validator1, 1, true);
    contract.voteOnSighting(accounts.validator2, 1, true);
    contract.voteOnSighting(accounts.validator3, 1, true);
    const details = contract.getSightingDetails(1);
    expect(details.value?.status).toBe("Approved");
  });

  it("should allow validators to vote and reach rejection quorum", () => {
    contract.startVerification(
      accounts.deployer,
      accounts.informant,
      mockEvidenceHash,
      "Elephant"
    );
    contract.voteOnSighting(accounts.validator1, 1, false);
    contract.voteOnSighting(accounts.validator2, 1, false);
    contract.voteOnSighting(accounts.validator3, 1, false);
    const details = contract.getSightingDetails(1);
    expect(details.value?.status).toBe("Rejected");
  });

  it("should prevent non-validators from voting", () => {
    contract.startVerification(
      accounts.deployer,
      accounts.informant,
      mockEvidenceHash,
      "Elephant"
    );
    const result = contract.voteOnSighting(accounts.nonValidator, 1, true);
    expect(result).toEqual({ ok: false, value: 100 });
  });

  it("should prevent double voting", () => {
    contract.startVerification(
      accounts.deployer,
      accounts.informant,
      mockEvidenceHash,
      "Elephant"
    );
    contract.voteOnSighting(accounts.validator1, 1, true);
    const secondVote = contract.voteOnSighting(accounts.validator1, 1, false);
    expect(secondVote).toEqual({ ok: false, value: 103 });
  });

  it("should allow initiating dispute within window", () => {
    contract.startVerification(
      accounts.deployer,
      accounts.informant,
      mockEvidenceHash,
      "Elephant"
    );
    contract.voteOnSighting(accounts.validator1, 1, true);
    contract.voteOnSighting(accounts.validator2, 1, true);
    contract.voteOnSighting(accounts.validator3, 1, true);
    const disputeResult = contract.initiateDispute(accounts.nonValidator, 1, Buffer.from("disputereason"));
    expect(disputeResult).toEqual({ ok: true, value: true });
    const details = contract.getSightingDetails(1);
    expect(details.value?.status).toBe("Disputed");
  });

  it("should prevent disputing after window", () => {
    contract.startVerification(
      accounts.deployer,
      accounts.informant,
      mockEvidenceHash,
      "Elephant"
    );
    contract.voteOnSighting(accounts.validator1, 1, true);
    contract.voteOnSighting(accounts.validator2, 1, true);
    contract.voteOnSighting(accounts.validator3, 1, true);
    contract.advanceBlockHeight(73); // Past dispute window
    const disputeResult = contract.initiateDispute(accounts.nonValidator, 1, Buffer.from("disputereason"));
    expect(disputeResult).toEqual({ ok: false, value: 110 });
  });

  it("should pause and unpause the contract", () => {
    const pauseResult = contract.pauseContract(accounts.deployer);
    expect(pauseResult).toEqual({ ok: true, value: true });
    expect(contract.state.paused).toBe(true);

    const unpauseResult = contract.unpauseContract(accounts.deployer);
    expect(unpauseResult).toEqual({ ok: true, value: true });
    expect(contract.state.paused).toBe(false);
  });

  it("should prevent non-admin from pausing", () => {
    const pauseResult = contract.pauseContract(accounts.nonValidator);
    expect(pauseResult).toEqual({ ok: false, value: 100 });
  });
});