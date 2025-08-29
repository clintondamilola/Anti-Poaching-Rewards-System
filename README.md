# 🦁 Anti-Poaching Rewards System

Welcome to a decentralized solution for combating wildlife poaching! This Web3 project uses the Stacks blockchain and Clarity smart contracts to create a transparent, trustless system that rewards informants for reporting verified wildlife sightings. By incentivizing community participation, it helps protect endangered species in real-time while ensuring fair and automated reward distribution. Funds can come from donations, NGOs, or governments, pooled on-chain for accountability.

## ✨ Features

🦌 Submit wildlife sightings with evidence (e.g., geotagged photos or coordinates)  
✅ Multi-step verification by trusted validators (e.g., rangers or AI oracles)  
💰 Automated reward payouts from a shared bounty pool using STX or custom tokens  
🔒 Transparent ledger of all reports, verifications, and payments to prevent fraud  
📊 Governance voting for system parameters like reward amounts or validator selection  
⚖️ Dispute resolution for contested sightings  
🌍 Integration with external oracles for real-world data (e.g., GPS validation)  
🚫 Anti-abuse mechanisms to penalize false reports  

## 🛠 How It Works

This system addresses the real-world problem of wildlife poaching by empowering local communities to report threats securely and earn rewards. It leverages blockchain for immutable records, reducing corruption in traditional reward programs. The project consists of 8 interconnected Clarity smart contracts for modularity, security, and scalability.

### Smart Contracts Overview
1. **InformantRegistry.clar**: Handles registration of informants, storing their STX addresses and basic profiles to prevent spam. Includes functions for KYC-like verification if needed.  
2. **SightingSubmission.clar**: Allows informants to submit sightings with details like location, species, evidence hash, and timestamp. Emits events for new reports.  
3. **ValidatorRegistry.clar**: Manages a pool of verified validators (e.g., wildlife experts or rangers) who stake tokens to participate. Includes slashing for misconduct.  
4. **VerificationProcess.clar**: Coordinates multi-validator voting on sightings. Requires a quorum (e.g., 3/5 approvals) for confirmation. Tracks verification status.  
5. **RewardPool.clar**: Manages the bounty fund, accepting deposits from donors and locking funds. Calculates dynamic rewards based on sighting rarity or urgency.  
6. **PaymentDistributor.clar**: Automates payouts to informants and validators upon successful verification. Handles splits (e.g., 70% to informant, 30% to validators).  
7. **DisputeResolution.clar**: Allows challenges to verified sightings within a time window. Uses arbitrator voting and evidence review; resolves with refunds or penalties.  
8. **Governance.clar**: Enables token holders to vote on updates like reward multipliers, validator requirements, or integrating new oracles. Uses DAO-style proposals.

### For Informants
- Register via InformantRegistry.  
- Submit a sighting using SightingSubmission, including a hash of evidence (e.g., photo uploaded off-chain).  
- Wait for verification—if approved, receive automatic rewards from PaymentDistributor.  

### For Validators
- Stake and register in ValidatorRegistry.  
- Vote on sightings in VerificationProcess.  
- Earn fees for accurate validations; risk slashing for errors via DisputeResolution.  

### For Donors/Funders
- Deposit STX or tokens into RewardPool.  
- Track usage transparently on the blockchain.  

### For Admins/Community
- Propose changes via Governance for ongoing improvements.  

Boom! Your contributions help save wildlife while building a fair, decentralized ecosystem. Deploy on Stacks for low-cost, Bitcoin-secured transactions. Start by deploying the contracts in sequence, with Governance as the entry point for initialization.