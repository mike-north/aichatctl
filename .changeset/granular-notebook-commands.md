---
"@aichatctl/sdk": major
"aichatctl": major
"@aichatctl/mcp": major
---

Replace the monolithic `notebook create` command with granular, observable operations:
`notebook new`, `notebook rename`, `notebook sources list/add/remove`, and
`notebook podcast create`. Each returns verifiable output so agents can confirm
state between steps instead of assuming success.
