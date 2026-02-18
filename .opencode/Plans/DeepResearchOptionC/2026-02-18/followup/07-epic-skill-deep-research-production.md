# Epic E7 — New skill: `deep-research-production`

## Why
Architect raw-2: split “mechanics” from “production research output.”

## Outcome
Create a new skill package for production prompting, policy, and quality loops:
- draft perspectives from query
- run wave1 with Task-backed driver + validation
- enforce citations ladder policy + operator intervention when blocked
- run synthesis/review quality loop (bounded)

## Deliverables
New skill directory + workflows:
- DraftPerspectivesFromQuery
- RunWave1WithTaskDriver
- OnlineCitationsLadderPolicy
- SynthesisAndReviewQualityLoop

## Validator gates
- Architect PASS, QA PASS.
