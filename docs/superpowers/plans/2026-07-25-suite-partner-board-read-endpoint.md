# Suite Partner Board Read Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the dashboard a machine-readable view of Suite pipeline rows — `GET /api/partner/v1/board`, guarded by the already-declared-but-unused `PartnerScope.LOANS_READ`, with a new `applicationDateEmpty` facet so "has a pre-approval date, has no application date" is a single call.

**Architecture:** A thin partner controller that builds a `PipelineFilter` and delegates to the *same* `BoardService.rows(...)` the staff board uses, so the partner view can never drift from the staff view. The one piece of genuinely new query logic is a `applicationReceivedDate IS NULL` predicate, which lands in `LoanSpecifications` alongside its sibling `applicationReceivedBetween` and is exposed as a new `PipelineFilter` facet — meaning the staff board gets it too.

**Tech Stack:** Java 21 / Spring Boot, Spring Security, Spring Data JPA Specifications, Gradle (Kotlin DSL), JUnit 5 + MockMvc + Testcontainers.

**Repo:** `~/MSFG/msfg-suite` — **not** the dashboard repo.

**Source spec:** `docs/superpowers/specs/2026-07-25-suite-integrations-preapprovals-design.md` §7

---

## Before you start

- **Work on a branch.** `git checkout -b feat/partner-board-read`.
- **No migration.** This plan adds no tables and no columns. **V39 stays the latest migration.**
  If you find yourself writing SQL, stop — you have misread the plan.
- **Check the latest migration version anyway** before you start, because another agent may have
  landed one: `ls app/src/main/resources/db/migration | tail -3`. If it is past V39, that is fine —
  just do not add to it.
- **Run the full suite before your first change** so you know the baseline is green:
  `./gradlew test`. If it is already red, stop and report — do not layer work on a red suite.

## The one non-obvious risk

`PipelineFilter` is a **positional record with 20 components**
(`loan-core/src/main/java/com/msfg/los/loan/web/dto/PipelineFilter.java`). Adding a 21st ripples to
every construction site. There are **seven**:

| File | Line | Form |
|---|---|---|
| `loan-core/.../loan/board/BoardReportsService.java` | 42 | all-null |
| `loan-core/.../loan/board/BoardService.java` | 78 | all-null |
| `loan-core/.../loan/board/BoardService.java` | 456 | copy-constructor, threads every field |
| `loan-core/.../loan/web/LoanController.java` | 86 | full |
| `loan-core/.../loan/web/BoardController.java` | 102 | full |
| `loan-core/.../loan/web/BoardController.java` | 140 | full |
| `loan-core/.../loan/web/BoardController.java` | 198 | full |

Miss one and it is a compile error, not a silent bug — the compiler is the safety net here. But
**line 456 is the dangerous one**: it is a copy constructor, so it compiles fine if you pass `null`
instead of `f.applicationDateEmpty()`, and the facet then silently vanishes whenever the LO-name
filter path runs. Task 2 has a test specifically for that.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `loan-core/.../loan/repo/LoanSpecifications.java` | Modify | New `applicationReceivedIsNull()` predicate |
| `loan-core/.../loan/web/dto/PipelineFilter.java` | Modify | New `applicationDateEmpty` component |
| `loan-core/.../loan/service/LoanService.java` | Modify | Wire the facet into the specification |
| 7 construction sites above | Modify | Thread the new component |
| `integrations/.../web/PartnerBoardController.java` | Create | Partner read endpoint; delegates, owns no query logic |
| `app/src/test/.../loan/board/BoardApplicationDateEmptyIT.java` | Create | Facet behaviour on the staff board |
| `app/src/test/.../integrations/PartnerBoardIT.java` | Create | Auth, scope, tenancy, paging cap |

---

### Task 1: The `applicationReceivedDate IS NULL` predicate

**Files:**
- Modify: `loan-core/src/main/java/com/msfg/los/loan/repo/LoanSpecifications.java` (after
  `applicationReceivedBetween`, which ends around line 252)
- Test: `app/src/test/java/com/msfg/los/loan/board/BoardApplicationDateEmptyIT.java` (create)

- [ ] **Step 1: Write the failing test**

Create `app/src/test/java/com/msfg/los/loan/board/BoardApplicationDateEmptyIT.java`.

Model the setup on the existing `BoardRowsIT` / `BoardDateFilterIT` in the same package — they
already have helpers for creating a loan and setting a tracked date. Read
`app/src/test/java/com/msfg/los/loan/board/BoardDateFilterIT.java` first and reuse its
`setTrackedDate(...)` and `boardIds(...)` helpers rather than reinventing them.

```java
package com.msfg.los.loan.board;

import com.msfg.los.support.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class BoardApplicationDateEmptyIT extends AbstractIntegrationTest {

    /** applicationDateEmpty=true keeps only loans whose applicationReceivedDate is null. */
    @Test
    void applicationDateEmpty_keepsOnlyLoansWithNoApplicationDate() throws Exception {
        String withApp = createLoanWithApplicationDate("2026-07-01");
        String noApp = createLoanWithApplicationDate(null);

        List<String> ids = boardIds("?applicationDateEmpty=true&size=200");

        assertThat(ids).contains(noApp);
        assertThat(ids).doesNotContain(withApp);
    }

    /** Omitting the facet is not the same as false — both must keep everything. */
    @Test
    void applicationDateEmptyAbsentOrFalse_keepsBoth() throws Exception {
        String withApp = createLoanWithApplicationDate("2026-07-02");
        String noApp = createLoanWithApplicationDate(null);

        assertThat(boardIds("?size=200")).contains(withApp, noApp);
        assertThat(boardIds("?applicationDateEmpty=false&size=200")).contains(withApp, noApp);
    }

    /** The facet must survive the LO-name filter path (BoardService copy-constructor, line 456). */
    @Test
    void applicationDateEmpty_survivesLoNameFilterPath() throws Exception {
        String withApp = createLoanWithApplicationDate("2026-07-03");
        String noApp = createLoanWithApplicationDate(null);
        String lo = loanOfficerNameFor(noApp);

        List<String> ids = boardIds("?applicationDateEmpty=true&lo=" + lo + "&size=200");

        assertThat(ids).contains(noApp);
        assertThat(ids).doesNotContain(withApp);
    }
}
```

You must add the three helpers (`createLoanWithApplicationDate`, `boardIds`,
`loanOfficerNameFor`) modelled on `BoardDateFilterIT`. `createLoanWithApplicationDate(null)` must
create the loan and leave `applicationReceivedDate` unset; passing a date must `PATCH
/api/loans/{id}` with `{"applicationReceivedDate":"<date>"}`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd ~/MSFG/msfg-suite && ./gradlew :app:test --tests '*BoardApplicationDateEmptyIT*'
```

Expected: FAIL. The first two tests fail because `applicationDateEmpty` is not a bound request
param, so it is ignored and both loans come back.

- [ ] **Step 3: Add the specification**

In `LoanSpecifications.java`, immediately after `applicationReceivedBetween`:

```java
    /** applicationReceivedDate IS NULL — the "not yet an application" facet. */
    public static Specification<Loan> applicationReceivedIsNull() {
        return (root, q, cb) -> cb.isNull(root.get("applicationReceivedDate"));
    }
```

- [ ] **Step 4: Add the record component**

In `PipelineFilter.java`, add as the **last** component (appending keeps the existing positional
order stable, exactly as `LoanStatus` did when the MSFG board statuses were appended):

```java
        List<UUID> idsExclude,
        Boolean applicationDateEmpty) {
```

And add the matching javadoc `@param` above the record:

```java
 * @param applicationDateEmpty {@code applicationDateEmpty} — TRUE keeps only loans with no
 *                    {@code applicationReceivedDate} (the pre-approval-not-yet-an-application set).
 *                    Null or FALSE → no constraint. Boxed on purpose: absent must differ from false.
```

- [ ] **Step 5: Thread it through all seven construction sites**

For the two all-null forms (`BoardReportsService.java:42`, `BoardService.java:78`) append one more
`null`. For the three `BoardController` sites and the one `LoanController` site append `null` for
now — Task 2 replaces the `BoardController:102` one with the real parameter.

For **`BoardService.java:456`**, the copy constructor, append the threaded accessor — not `null`:

```java
                f.lenderEmpty(), f.idsExclude(), f.applicationDateEmpty());
```

- [ ] **Step 6: Wire the facet into the query**

In `LoanService`, find where `pipelineSpecification` composes the other facets (it is the method
`BoardService:401` calls) and add:

```java
        if (Boolean.TRUE.equals(filter.applicationDateEmpty())) {
            spec = spec.and(LoanSpecifications.applicationReceivedIsNull());
        }
```

Use `Boolean.TRUE.equals(...)`, not `filter.applicationDateEmpty()` — the field is boxed and
unboxing a null throws.

- [ ] **Step 7: Bind the request param on the staff board**

In `BoardController.rows(...)`, add the parameter alongside the other optional facets:

```java
            @RequestParam(required = false) Boolean applicationDateEmpty,
```

and pass it into the `new PipelineFilter(...)` at line 102 in place of the `null` you appended in
Step 5.

- [ ] **Step 8: Run the test to verify it passes**

```bash
cd ~/MSFG/msfg-suite && ./gradlew :app:test --tests '*BoardApplicationDateEmptyIT*'
```

Expected: PASS, all three tests.

- [ ] **Step 9: Run the full suite — the record change touched shared code**

```bash
cd ~/MSFG/msfg-suite && ./gradlew test
```

Expected: BUILD SUCCESSFUL. A compile error naming `PipelineFilter` means you missed one of the
seven sites. A *behavioural* failure in a board or reports test means you passed `null` at
`BoardService:456` instead of threading the accessor.

- [ ] **Step 10: Commit**

```bash
git add loan-core/src/main/java/com/msfg/los/loan/repo/LoanSpecifications.java \
        loan-core/src/main/java/com/msfg/los/loan/web/dto/PipelineFilter.java \
        loan-core/src/main/java/com/msfg/los/loan/service/LoanService.java \
        loan-core/src/main/java/com/msfg/los/loan/board/BoardService.java \
        loan-core/src/main/java/com/msfg/los/loan/board/BoardReportsService.java \
        loan-core/src/main/java/com/msfg/los/loan/web/BoardController.java \
        loan-core/src/main/java/com/msfg/los/loan/web/LoanController.java \
        app/src/test/java/com/msfg/los/loan/board/BoardApplicationDateEmptyIT.java
git commit -m "feat(board): applicationDateEmpty facet — loans with no application date"
```

---

### Task 2: The partner board endpoint

**Files:**
- Create: `integrations/src/main/java/com/msfg/los/integrations/web/PartnerBoardController.java`
- Test: `app/src/test/java/com/msfg/los/integrations/PartnerBoardIT.java` (create)

- [ ] **Step 1: Write the failing test**

Create `app/src/test/java/com/msfg/los/integrations/PartnerBoardIT.java`. The key-minting and
auth-header pattern is lifted directly from the existing `PartnerDocumentsIT` in the same package —
read it first.

```java
package com.msfg.los.integrations;

import com.msfg.los.support.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class PartnerBoardIT extends AbstractIntegrationTest {

    private static final String ADMIN_SUB = "10000000-0000-0000-0000-00000000ad02";

    @Autowired MockMvc mvc;

    private String readKey;    // scopes: loans:read
    private String writeKey;   // scopes: loans:write only — must be forbidden here

    private RequestPostProcessor admin() {
        return jwt().jwt(j -> j.subject(ADMIN_SUB).claim("org_id", DEFAULT_ORG))
                .authorities(new SimpleGrantedAuthority("ROLE_ADMIN"));
    }

    private String mintKey(String label, String scopesJson) throws Exception {
        var res = mvc.perform(post("/api/integrations/keys").with(admin())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                            {"label":"%s","scopes":%s,"sourceSystem":"dashboard"}"""
                                .formatted(label, scopesJson)))
                .andExpect(status().isCreated()).andReturn();
        return read(res.getResponse().getContentAsString(), "$.data.rawKey");
    }

    @BeforeEach
    void seed() throws Exception {
        readKey = mintKey("dashboard read", "[\"loans:read\"]");
        writeKey = mintKey("write only", "[\"loans:write\"]");
    }

    @Test
    void missingKey_is401() throws Exception {
        mvc.perform(get("/api/partner/v1/board"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("KEY_INVALID"));
    }

    @Test
    void keyWithoutLoansRead_is403() throws Exception {
        mvc.perform(get("/api/partner/v1/board").header("Authorization", "Bearer " + writeKey))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("MISSING_SCOPE"));
    }

    @Test
    void keyWithLoansRead_returnsAPage() throws Exception {
        mvc.perform(get("/api/partner/v1/board").header("Authorization", "Bearer " + readKey))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.items").isArray())
                .andExpect(jsonPath("$.data.page").value(0));
    }

    @Test
    void sizeAboveCap_is400() throws Exception {
        mvc.perform(get("/api/partner/v1/board?size=500")
                        .header("Authorization", "Bearer " + readKey))
                .andExpect(status().isBadRequest());
    }

    @Test
    void sizeAtCap_isAllowed() throws Exception {
        mvc.perform(get("/api/partner/v1/board?size=200")
                        .header("Authorization", "Bearer " + readKey))
                .andExpect(status().isOk());
    }
}
```

> `$.error.code` assumes the `ApiError` shape written by `PartnerSecurityConfig.writeError`. Open
> `platform/src/main/java/com/msfg/los/platform/web/ApiError.java` and match the real JSON path
> before running — if the field is at `$.code`, use that instead. Do not guess.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd ~/MSFG/msfg-suite && ./gradlew :app:test --tests '*PartnerBoardIT*'
```

Expected: FAIL. `missingKey_is401` and `keyWithoutLoansRead_is403` may already pass — the partner
chain is default-deny, so an unmapped path under `/api/partner/**` still 401s. The three that must
fail are the 200 and the two size cases, because no handler exists yet.

- [ ] **Step 3: Create the controller**

```java
package com.msfg.los.integrations.web;

import com.msfg.los.loan.board.BoardService;
import com.msfg.los.loan.domain.LoanStatus;
import com.msfg.los.loan.web.dto.BoardDateField;
import com.msfg.los.loan.web.dto.BoardRowResponse;
import com.msfg.los.loan.web.dto.PipelineFilter;
import com.msfg.los.platform.error.ValidationException;
import com.msfg.los.platform.web.ApiResponse;
import com.msfg.los.platform.web.PagedResponse;
import io.swagger.v3.oas.annotations.Operation;
import org.springframework.data.domain.Page;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;

/**
 * Machine-readable pipeline board for partner keys. Deliberately a THIN delegation to the same
 * {@link BoardService#rows} the staff board uses — this class owns no query logic, so the partner
 * view cannot drift from the staff view.
 *
 * <p>Differences from the staff board, all intentional:
 * <ul>
 *   <li>Narrower facet surface — no {@code ids}, no cell writes, no layout.</li>
 *   <li>Always org-wide: a partner key has no owning loan officer, so caller-scoping is
 *       meaningless. Tenancy still comes from the key's {@code org_id} via TenantContextFilter
 *       and RLS — never from a request parameter.</li>
 *   <li>{@code size} is capped so a machine key cannot pull the whole org in one request.</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/partner/v1/board")
public class PartnerBoardController {

    /** Hard ceiling on page size for machine callers. */
    static final int MAX_PAGE_SIZE = 200;

    private final BoardService board;

    public PartnerBoardController(BoardService board) {
        this.board = board;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('SCOPE_loans:read')")
    @Operation(operationId = "partnerGetBoardRows")
    public ApiResponse<PagedResponse<BoardRowResponse>> rows(
            @RequestParam(required = false) List<String> lo,
            @RequestParam(required = false) List<LoanStatus> status,
            @RequestParam(required = false) List<LoanStatus> statusExclude,
            @RequestParam(required = false) BoardDateField dateField,
            @RequestParam(required = false) LocalDate dateFrom,
            @RequestParam(required = false) LocalDate dateTo,
            @RequestParam(required = false) Boolean applicationDateEmpty,
            @RequestParam(required = false) String sort,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {

        if (size > MAX_PAGE_SIZE) {
            throw new ValidationException(
                    "size must be <= " + MAX_PAGE_SIZE + " for partner keys");
        }

        // Org-wide, no caller LO: a partner key is not a person. Tenancy is enforced upstream.
        PipelineFilter filter = new PipelineFilter(
                status, null, null, null, null, null, null, null, null, null, null,
                statusExclude, null, null, null, dateField, dateFrom, dateTo, null, null,
                applicationDateEmpty);

        PipelineFilter effective = board.applyLoNameFilter(filter, lo, null, null, true, null);
        Page<BoardRowResponse> result = board.rows(effective, sort, true, null, page, size);
        return ApiResponse.ok(PagedResponse.from(result));
    }
}
```

> **Verify the positional arity before compiling.** The `new PipelineFilter(...)` above must have
> exactly 21 arguments in the record's declared order. Open `PipelineFilter.java` side by side and
> count. The compiler catches a wrong *count*, but not a wrong *order* between two same-typed
> fields — e.g. swapping `status` and `statusExclude` compiles fine and silently inverts the
> filter. Read them off one at a time.

- [ ] **Step 4: Confirm `ValidationException` maps to 400**

```bash
cd ~/MSFG/msfg-suite && grep -rn "ValidationException" --include='*.java' platform/src/main/java | grep -i "handler\|advice\|400\|BAD_REQUEST"
```

Expected: a `@ExceptionHandler` mapping it to `400`. If there is none, use whatever the codebase's
established 400 path is instead — do not invent a new exception type.

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd ~/MSFG/msfg-suite && ./gradlew :app:test --tests '*PartnerBoardIT*'
```

Expected: PASS, all five tests.

- [ ] **Step 6: Commit**

```bash
git add integrations/src/main/java/com/msfg/los/integrations/web/PartnerBoardController.java \
        app/src/test/java/com/msfg/los/integrations/PartnerBoardIT.java
git commit -m "feat(partner): GET /api/partner/v1/board behind loans:read scope"
```

---

### Task 3: Tenant isolation

The single most important test in this plan. A read endpoint that leaks another org's loans is far
worse than one that does not exist.

**Files:**
- Modify: `app/src/test/java/com/msfg/los/integrations/PartnerBoardIT.java`

- [ ] **Step 1: Write the failing test**

Append to `PartnerBoardIT`:

```java
    /**
     * A key belongs to exactly one org. Even though this endpoint is org-WIDE (no caller
     * scoping), it must never see another tenant's loans — that comes from the synthetic
     * principal's org_id via TenantContextFilter + RLS, never from a request param.
     */
    @Test
    void keyFromAnotherOrg_seesNoneOfThisOrgsLoans() throws Exception {
        String mine = createLoanInDefaultOrg();

        String foreignKey = mintKeyForOrg(OTHER_ORG, "foreign", "[\"loans:read\"]");

        mvc.perform(get("/api/partner/v1/board?size=200")
                        .header("Authorization", "Bearer " + foreignKey))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[?(@.id=='" + mine + "')]").isEmpty());
    }
```

You need `OTHER_ORG`, `mintKeyForOrg`, and `createLoanInDefaultOrg`. Check whether
`AbstractIntegrationTest` already exposes a second org constant alongside `DEFAULT_ORG`
(`00000000-0000-0000-0000-0000000000aa`); other ITs in this repo already prove tenant isolation, so
**find one and copy its approach** rather than inventing a second-org fixture:

```bash
cd ~/MSFG/msfg-suite && grep -rln "tenant\|OTHER_ORG\|foreignTenant" app/src/test/java --include='*IT.java' | head -5
```

- [ ] **Step 2: Run to verify it fails or passes for the right reason**

```bash
cd ~/MSFG/msfg-suite && ./gradlew :app:test --tests '*PartnerBoardIT*'
```

Expected: PASS — RLS and `@TenantId` should already enforce this, because the partner filter
installs a synthetic principal carrying the key's org.

**If it FAILS, stop and report immediately.** That is a real tenant-isolation hole, and it is not
something to patch inside this task. Do not proceed to Task 4.

**If it passes on the first run**, confirm the test is not vacuous — temporarily assert
`.isNotEmpty()` instead, watch it fail, then put it back. A tenancy test that would pass against a
broken implementation is worse than no test.

- [ ] **Step 3: Commit**

```bash
git add app/src/test/java/com/msfg/los/integrations/PartnerBoardIT.java
git commit -m "test(partner): prove board rows are tenant-isolated for partner keys"
```

---

### Task 4: Verify the published contract

**Files:** none — verification only.

- [ ] **Step 1: Full suite**

```bash
cd ~/MSFG/msfg-suite && ./gradlew test
```

Expected: BUILD SUCCESSFUL.

- [ ] **Step 2: Confirm the endpoint reaches OpenAPI**

```bash
cd ~/MSFG/msfg-suite && ./gradlew :app:bootRun --args='--spring.profiles.active=local' &
sleep 45
curl -s localhost:8080/v3/api-docs | grep -o 'partnerGetBoardRows'
curl -s localhost:8080/v3/api-docs | grep -o '/api/partner/v1/board'
kill %1
```

Expected: both strings present. The dashboard side (Plan C) generates its client understanding from
`/v3/api-docs`, so an endpoint missing from the spec is a broken handoff even if the code works.

- [ ] **Step 3: Report**

State: full suite result, and whether `partnerGetBoardRows` appears in the OpenAPI document. Do not
claim success without both.

---

## Deploy handoff

Deploying is the user's call. When they ask, the order is:

1. Merge to `main`, deploy the suite box (`deploy-suite.sh`). **No migration**, so nothing to
   verify on the DB side beyond the app booting.
2. Confirm `https://los.msfgco.com/v3/api-docs` lists `partnerGetBoardRows`.
3. Mint the dashboard's key — admin JWT required:
   `POST /api/integrations/keys` with `{"label":"dashboard pre-approvals","scopes":["loans:read"],"sourceSystem":"dashboard"}`.
   **The raw key is returned once and never again.** Put it straight into the dashboard EC2
   backend `.env` as `SUITE_PARTNER_API_KEY` — that is Plan C's step 3.
4. Only `loans:read`. No write scopes until the Phase 4 write-back work.

---

## Self-Review

**Spec coverage (§7 of the design doc):**

| §7 requirement | Task |
|---|---|
| `GET /api/partner/v1/board`, `@PreAuthorize hasAuthority('SCOPE_loans:read')` | 2 |
| `operationId = partnerGetBoardRows` | 2, verified in 4 |
| Delegate to `BoardService.rows`, no duplicated query logic | 2 |
| Narrow facet surface; no `ids`, no cell writes | 2 |
| New `applicationDateEmpty` filter on `PipelineFilter` | 1 |
| Org scope only, never caller scope; tenancy from the principal | 2, proven in 3 |
| Cap `size`, reject above it with 400 | 2 |
| Tests: 401, 403, 200, dateField narrowing, applicationDateEmpty, size cap, tenant isolation | 1 (dateField/facet), 2 (401/403/200/cap), 3 (tenancy) |
| No migration — V39 stays latest | Stated in "Before you start" |
| Key provisioning via `PartnerKeyAdminController`, `loans:read` only | Deploy handoff |

No gaps.

**Placeholder scan:** no TBDs. Three steps deliberately say *read the existing file and copy its
approach* rather than inlining code — `BoardDateFilterIT` helpers (Task 1 Step 1), the `ApiError`
JSON path (Task 2 Step 1), and the second-org fixture (Task 3 Step 1). Each names the exact file or
gives the exact command to find it, and each says explicitly not to guess. Inlining invented
versions of repo-specific fixtures would be worse than pointing at the real ones.

**Type/name consistency:** `applicationDateEmpty` is the wire param, the `PipelineFilter`
component, and the `BoardController`/`PartnerBoardController` parameter — one spelling throughout.
`applicationReceivedIsNull()` (Task 1 Step 3) is the only new `LoanSpecifications` method and is
called once, in Task 1 Step 6. `MAX_PAGE_SIZE` is defined and used in the same class and asserted
at both boundaries (200 allowed, 500 rejected) in Task 2 Step 1. `PartnerScope.LOANS_READ` already
exists — this plan adds no enum value, it only becomes the first consumer of one.

**Ordering check:** Task 1 must land before Task 2, because Task 2's `new PipelineFilter(...)`
has 21 arguments. Task 3 must land after Task 2, because it calls the endpoint.
