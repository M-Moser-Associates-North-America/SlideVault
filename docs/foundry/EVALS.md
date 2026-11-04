# SlideVault evaluations (code freeze, 2026-11-02)

What we measured, how, and what it showed. Two kinds of evidence: the client's own searches run against the real library, and the automated checks that guard every rule. Client and people names are left out of this file; the searches are quoted as the client typed them, with names replaced by their kind.

## 1. The client's own searches, on the real library

Every search Alina and Gabby typed or described in the 28 Oct check-in, plus the searches BD staff gave in the survey, run against the real library (23 decks, about 1,900 slides) with no AI model, so the result is the same every time. Each search has a pass rule written before running it.

**15 of 15 pass (100%)** on the shared database (2 Nov). On the local library, which has no deck locations, 14 of 15.

| Search | From | Pass rule | Result |
|---|---|---|---|
| "firm overview" | Gabby, 28:40 | The slide she meant (a named team member's page) in the top 10, and most of the top 10 from firm-overview sections | Pass: it's there, 6 of 10 from firm sections |
| "recent IDD deck… case studies in [a city]" | Gabby, 17:20 | 8 of the top 10 from that city | **Pass: 10 of 10** on the shared database, 5 of them naming the city (3 of 10 locally, see below) |
| "[client] case study" | Gabby, 38:48 | That client on all of the top 10 | Pass: 10 of 10 |
| "[client] msa" | Alina, 39:24 | That client on all of the top 10 | Pass: 10 of 10 |
| "2026" | Alina, 43:09 | All of the top 10 from 2026 decks | Pass: 10 of 10 |
| "what is our most recent hospitality deck" | Alina, 36:26 | Hospitality on all of the top 10 | Pass: 10 of 10 |
| "banner slides in case studies" | Alina, 42:25 | Case-study section covers or project hero slides | Pass: 5 of 10 |
| "resumes" | Gabby, 52:00 | Résumés in 8 of the top 10 | Pass: 8 of 10 |
| "[person] resume" | Gabby, 55:56 | That person's slide first | Pass |
| "North America overview" | Gabby, 34:59 | North America in 8 of the top 10 | Pass: 8 of 10 |
| "Case Study" | Survey | Case studies in 8 of the top 10 | Pass: 8 of 10 |
| "Workplace strategy process" | Survey | The workplace strategy deck in the top 10 | Pass: 3 of 10 |
| "QA/QC methodology process" | Survey | QA or QC in 5 of the top 10 | Pass: 5 of 10 |
| "slides that demonstrate our firm's value proposition" | Survey | About-the-firm or differentiator slides in 5 of the top 10 | Pass: 5 of 10 |
| "Looking for a strategy proposal" | Survey | The workplace strategy deck in the top 10 | Pass: 3 of 10 |

**The city search.** "Case studies in [a city]" missed on the local library (3 of 10), where decks have no recorded location, so case studies from other places ranked above the ones that name the city. After the fix that makes a deck's location add to the word match rather than replace it (#19), and with deck locations filled in on the shared database, it was checked there on 2 Nov: all 10 of the top 10 came from that city's deck, 5 of them naming the city, and the search read "recent", "IDD" and "case studies" as filters on its own. Caveat: only one recent IDD deck from that city is in the library, so this shows the right deck wins, not how it ranks against several.

How to run it: the meeting-search script in the data folder (outside this repo, since it names real clients), with the real library settings loaded.

## 2. Automated checks

Run with no database and no AI model, on every change. All pass at the freeze.

| Suite | Checks | What it guards |
|---|---|---|
| test:smart-search | 129 | How a search is read (sections, named things, years, places, recency), own tags first, Useful / Not relevant, hidden slides |
| test:storyboard | 124 | Every story slide speaks to the brief, the right slide in each part, learning from search and tags, retold decks kept whole and grouped by their own sections |
| test:deck-finder | 45 | Finding a whole deck by client, year or kind, and saying when there isn't one |
| test:export | 43 | Real, editable PowerPoint out: nothing unselected left inside, metadata and notes scrubbed |
| test:story-learning | 42 | Storyboard Useful / Not useful only from people who opted in |
| test:combine | 25 | Several decks combined into one deck |
| test:reasoning-map | 22 | Client situations the storyboard recognises |

Plus the smaller suites (duplicates, deck details, folder paths, slide text, upload preview, deck suggestions), typecheck and lint. The database suites (packs, tags, search context, user data, meaning search) run against a local test database and in CI.

## 3. What is not measured yet

- **Time saved.** No timed comparison of finding a slide by hand versus in SlideVault. This is the number the client will care about most.
- **AI-read searches and stories.** Everything above is rules only, so it's repeatable. With an AI model on, results vary run to run; there is no scored set for that yet.
- **Real use.** Useful / Not relevant and tags only start teaching once people use them; there's no usage data yet.
