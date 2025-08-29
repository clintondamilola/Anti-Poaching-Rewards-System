;; VerificationProcess.clar
;; Core smart contract for anti-poaching rewards system.
;; Handles verification workflow for wildlife sightings, coordinating validators,
;; enforcing quorum-based decisions, and integrating with other system contracts.

;; Traits
(define-trait validator-registry-trait
  (
    (is-registered-validator (principal) (response bool uint))
  )
)

(define-trait payment-distributor-trait
  (
    (distribute-reward (uint principal) (response bool uint))
  )
)

(define-trait dispute-resolution-trait
  (
    (initiate-dispute (uint principal (buff 32)) (response bool uint))
  )
)

;; Constants
(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-SIGHTING-NOT-FOUND u101)
(define-constant ERR-VOTING-CLOSED u102)
(define-constant ERR-ALREADY-VOTED u103)
(define-constant ERR-QUORUM-NOT-MET u104)
(define-constant ERR-INVALID-STATUS u105)
(define-constant ERR-INVALID-PARAMETER u106)
(define-constant ERR-CONTRACT-PAUSED u107)
(define-constant ERR-DEADLINE-EXPIRED u108)
(define-constant ERR-INSUFFICIENT-VALIDATORS u109)
(define-constant ERR-DISPUTE_WINDOW_CLOSED u110)

(define-constant QUORUM u3) ;; Minimum approvals needed
(define-constant VOTE_WINDOW u144) ;; ~24 hours in blocks
(define-constant DISPUTE_WINDOW u72) ;; ~12 hours after verification
(define-constant MIN_VALIDATORS_REQUIRED u5) ;; For starting verification

;; Data Variables
(define-data-var contract-paused bool false)
(define-data-var admin principal tx-sender)
(define-data-var sighting-counter uint u0)
(define-data-var required-quorum uint QUORUM)
(define-data-var vote-window-blocks uint VOTE_WINDOW)
(define-data-var dispute-window-blocks uint DISPUTE_WINDOW)

;; Data Maps
(define-map Sightings
  { sighting-id: uint }
  {
    informant: principal,
    evidence-hash: (buff 32),
    status: (string-ascii 20), ;; "Pending", "Approved", "Rejected", "Disputed"
    votes-for: uint,
    votes-against: uint,
    total-votes: uint,
    deadline: uint,
    verification-timestamp: (optional uint),
    location: (optional { lat: int, long: int }),
    species: (string-utf8 50)
  }
)

(define-map ValidatorVotes
  { sighting-id: uint, validator: principal }
  { vote: bool, timestamp: uint }
)

;; Private Functions
(define-private (has-voted (sighting-id uint) (validator principal))
  (is-some (map-get? ValidatorVotes { sighting-id: sighting-id, validator: validator }))
)

(define-private (update-vote-counts (sighting-id uint) (approve bool))
  (let ((sighting (unwrap! (map-get? Sightings { sighting-id: sighting-id }) (err ERR-SIGHTING-NOT-FOUND))))
    (map-set Sightings { sighting-id: sighting-id }
      (merge sighting {
        votes-for: (if approve (+ (get votes-for sighting) u1) (get votes-for sighting)),
        votes-against: (if approve (get votes-against sighting) (+ (get votes-against sighting) u1)),
        total-votes: (+ (get total-votes sighting) u1)
      }))
    (ok true)
  )
)

(define-private (check-verification-status (sighting-id uint))
  (let ((sighting (unwrap! (map-get? Sightings { sighting-id: sighting-id }) (err ERR-SIGHTING-NOT-FOUND))))
    (if (>= (get votes-for sighting) (var-get required-quorum))
      (begin
        (map-set Sightings { sighting-id: sighting-id }
          (merge sighting {
            status: "Approved",
            verification-timestamp: (some block-height)
          }))
        (try! (contract-call? .payment-distributor distribute-reward sighting-id (get informant sighting)))
        (print { event: "sighting-verified", sighting-id: sighting-id, informant: (get informant sighting), timestamp: block-height })
        (ok "Approved")
      )
      (if (>= (get votes-against sighting) (var-get required-quorum))
        (begin
          (map-set Sightings { sighting-id: sighting-id }
            (merge sighting { status: "Rejected" }))
          (print { event: "sighting-rejected", sighting-id: sighting-id, timestamp: block-height })
          (ok "Rejected")
        )
        (if (and (> block-height (get deadline sighting)) (>= (get total-votes sighting) MIN_VALIDATORS_REQUIRED))
          (begin
            (map-set Sightings { sighting-id: sighting-id }
              (merge sighting { status: (if (> (get votes-for sighting) (get votes-against sighting)) "Approved" "Rejected") }))
            (if (> (get votes-for sighting) (get votes-against sighting))
              (begin
                (try! (contract-call? .payment-distributor distribute-reward sighting-id (get informant sighting)))
                (print { event: "sighting-auto-verified", sighting-id: sighting-id, timestamp: block-height })
              )
              (print { event: "sighting-auto-rejected", sighting-id: sighting-id, timestamp: block-height })
            )
            (ok "Auto-Finalized")
          )
          (ok "Pending")
        )
      )
    )
  )
)

(define-private (is-validator (user principal))
  (contract-call? .validator-registry is-registered-validator user)
)

;; Public Functions
(define-public (start-verification
  (informant principal)
  (evidence-hash (buff 32))
  (species (string-utf8 50))
  (location (optional { lat: int, long: int })))
  (begin
    (asserts! (not (var-get contract-paused)) (err ERR-CONTRACT-PAUSED))
    (asserts! (is-eq (get status (default-to { status: "None" } (map-get? Sightings { sighting-id: (var-get sighting-counter) }))) "None") (err ERR-INVALID-STATUS))
    (let ((new-id (+ (var-get sighting-counter) u1)))
      (map-set Sightings
        { sighting-id: new-id }
        {
          informant: informant,
          evidence-hash: evidence-hash,
          status: "Pending",
          votes-for: u0,
          votes-against: u0,
          total-votes: u0,
          deadline: (+ block-height (var-get vote-window-blocks)),
          verification-timestamp: none,
          location: location,
          species: species
        })
      (var-set sighting-counter new-id)
      (print { event: "verification-started", sighting-id: new-id, informant: informant, timestamp: block-height })
      (ok new-id)
    )
  )
)

(define-public (vote-on-sighting (sighting-id uint) (approve bool) (comment (optional (string-utf8 200))))
  (let ((sighting (unwrap! (map-get? Sightings { sighting-id: sighting-id }) (err ERR-SIGHTING-NOT-FOUND))))
    (asserts! (not (var-get contract-paused)) (err ERR-CONTRACT-PAUSED))
    (asserts! (is-ok (is-validator tx-sender)) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-eq (get status sighting) "Pending") (err ERR-INVALID-STATUS))
    (asserts! (< block-height (get deadline sighting)) (err ERR-VOTING-CLOSED))
    (asserts! (not (has-voted sighting-id tx-sender)) (err ERR-ALREADY-VOTED))
    (map-set ValidatorVotes
      { sighting-id: sighting-id, validator: tx-sender }
      { vote: approve, timestamp: block-height })
    (try! (update-vote-counts sighting-id approve))
    (print { event: "vote-cast", sighting-id: sighting-id, validator: tx-sender, approve: approve, comment: comment, timestamp: block-height })
    (try! (check-verification-status sighting-id))
    (ok true)
  )
)

(define-public (initiate-dispute (sighting-id uint) (reason (buff 32)))
  (let ((sighting (unwrap! (map-get? Sightings { sighting-id: sighting-id }) (err ERR-SIGHTING-NOT-FOUND))))
    (asserts! (not (var-get contract-paused)) (err ERR-CONTRACT-PAUSED))
    (asserts! (or (is-eq (get status sighting) "Approved") (is-eq (get status sighting) "Rejected")) (err ERR-INVALID-STATUS))
    (asserts! (is-some (get verification-timestamp sighting)) (err ERR-INVALID-STATUS))
    (asserts! (< block-height (+ (unwrap! (get verification-timestamp sighting) (err ERR-INVALID-STATUS)) (var-get dispute-window-blocks))) (err ERR-DISPUTE_WINDOW_CLOSED))
    (try! (contract-call? .dispute-resolution initiate-dispute sighting-id tx-sender reason))
    (map-set Sightings { sighting-id: sighting-id }
      (merge sighting { status: "Disputed" }))
    (print { event: "dispute-initiated", sighting-id: sighting-id, disputant: tx-sender, reason: reason, timestamp: block-height })
    (ok true)
  )
)

(define-public (pause-contract)
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (var-set contract-paused true)
    (print { event: "contract-paused", admin: tx-sender, timestamp: block-height })
    (ok true)
  )
)

(define-public (unpause-contract)
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (var-set contract-paused false)
    (print { event: "contract-unpaused", admin: tx-sender, timestamp: block-height })
    (ok true)
  )
)

(define-public (update-quorum (new-quorum uint))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (asserts! (> new-quorum u0) (err ERR-INVALID-PARAMETER))
    (var-set required-quorum new-quorum)
    (print { event: "quorum-updated", new-quorum: new-quorum, timestamp: block-height })
    (ok true)
  )
)

(define-public (update-vote-window (new-window uint))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (asserts! (> new-window u0) (err ERR-INVALID-PARAMETER))
    (var-set vote-window-blocks new-window)
    (print { event: "vote-window-updated", new-window: new-window, timestamp: block-height })
    (ok true)
  )
)

(define-public (update-dispute-window (new-window uint))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (asserts! (> new-window u0) (err ERR-INVALID-PARAMETER))
    (var-set dispute-window-blocks new-window)
    (print { event: "dispute-window-updated", new-window: new-window, timestamp: block-height })
    (ok true)
  )
)

(define-public (set-admin (new-admin principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (var-set admin new-admin)
    (print { event: "admin-updated", new-admin: new-admin, timestamp: block-height })
    (ok true)
  )
)

;; Read-Only Functions
(define-read-only (get-sighting-details (sighting-id uint))
  (map-get? Sightings { sighting-id: sighting-id })
)

(define-read-only (get-validator-vote (sighting-id uint) (validator principal))
  (map-get? ValidatorVotes { sighting-id: sighting-id, validator: validator })
)

(define-read-only (get-contract-status)
  {
    paused: (var-get contract-paused),
    admin: (var-get admin),
    quorum: (var-get required-quorum),
    vote-window: (var-get vote-window-blocks),
    dispute-window: (var-get dispute-window-blocks),
    sighting-count: (var-get sighting-counter)
  }
)

(define-read-only (can-dispute (sighting-id uint))
  (let ((sighting (default-to { status: "None", verification-timestamp: none } (map-get? Sightings { sighting-id: sighting-id }))))
    (and
      (or (is-eq (get status sighting) "Approved") (is-eq (get status sighting) "Rejected"))
      (is-some (get verification-timestamp sighting))
      (< block-height (+ (unwrap! (get verification-timestamp sighting) false) (var-get dispute-window-blocks)))
    )
  )
)

(define-read-only (has-sighting-expired (sighting-id uint))
  (let ((sighting (map-get? Sightings { sighting-id: sighting-id })))
    (if (is-some sighting)
      (> block-height (get deadline (unwrap-panic sighting)))
      false
    )
  )
)