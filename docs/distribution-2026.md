# Distribution — which of the six apps this system fits

A creator-network playbook was put to me: four consumer apps past $100k a month,
100–500 million views a month, 200 creators run through a training course with a
quiz at the end. The system is real and it is well built. This file is about
whether it points at Dash Light, and the answer is no — which matters more than
it sounds, because five other apps ship from this same codebase.

## The part everyone skips

The interesting decision in that story is not TikTok. It is that the apps were
**chosen to fit the distribution before they were built**. A glow-up app for
women was picked because a looks-maxing app for men was already working; the
second app moved to students because students had more money. The playbook came
first and the product was fitted to it.

Every app in this repository was chosen the other way round — from what could be
built. That is not a mistake, but it means the distribution question has to be
asked per app rather than assumed to have one answer.

## The five-axis test

| Axis | Why it decides |
|---|---|
| **Frequency** | Used weekly, or on a day nobody can schedule? |
| **Visible output** | Is the result a picture, or a paragraph? |
| **Forwardable** | Would somebody send it to a person they know? |
| **Standing demand** | Does the audience want this today, or only on trigger day? |
| **Proven format** | Has another app already found the shape of the video? |

## Dash Light scores 1 out of 5

| | |
|---|---|
| Frequency | **✗** two to four times a year |
| Visible output | **✗** a verdict and a paragraph |
| Forwardable | **✗** nobody shows anyone their oil pressure light |
| Standing demand | **✗** the demand arrives with the light, and not before |
| Proven format | ✓ eleven competitors, all selling the same six things |

The failure is the fourth row and it is not fixable by better content. Five
hundred million views of a dashboard scanner reach an audience whose dashboards
are dark. There is no demand standing there to capture — the best a video can do
is ask a viewer to *remember* an app for a day that may be months away, which is
a far weaker action than "install this to see what it says about your face", and
it converts accordingly.

This is the same conclusion the ASO file reached from the other direction: the
largest visible app in the category takes about 1,200 downloads a month, and
that is roughly the whole category's search demand. A crisis app is not starved
of marketing. It is bounded by how often the crisis happens.

**So the launch decision already made — ship Dash Light with no ad spend, as a
rehearsal for the pipeline — was the right one, and nothing here changes it.**

## What Dash Light's distribution actually is

There is a content strategy for a crisis app, and it is not the app.

*"If this light is flashing, do not keep driving"* is watched to the end, saved,
and forwarded — not because anyone wants a scanner, but because it is useful and
slightly frightening. The app is the answer at the end of it, appearing once.

That bank already existed in the repository: 48 lights, each with a severity, a
plain explanation and one action, written and reviewed in two languages. It is
now generated rather than transcribed — `node scripts/content-bank.js` writes
`store/content-bank.md`, and `npm run check:content` fails if the guide moves and
the shot list does not. A video giving safety advice the app has since withdrawn
stays up forever; that is the drift worth a check.

Two entries are marked **do not shoot**: their pictograms are the wrong symbol.
Inside the app that is a bug in two of forty-eight rows. In a video it teaches a
driver the wrong shape for a red light, and it keeps teaching it after the fix.

## The apps in this repository that do fit

Scored on the same five axes.

| Pack | Freq | Visible | Fwd | Standing | Proven | |
|---|:--:|:--:|:--:|:--:|:--:|---|
| `dogtrain` | ✓ | ✓ | ✓ | ✓ | ✓ | **5** |
| `womensfit` | ✓ | ✓ | ✓ | ✓ | ✓ | **5** |
| `goldscan` | ~ | ✓ | ✓ | ✓ | ✓ | **4½** |
| `bugscan` | ~ | ✓ | ✓ | ~ | ✓ | **4** |
| `mahdar` | ✓ | ✗ | ~ | ~ | ~ | **3** |
| `dashlight` | ✗ | ✗ | ✗ | ✗ | ✓ | **1** |

A high score is not a recommendation on its own, because the two fives are the
two most contested categories on the internet. Fitness and dog training are
where every creator-network app already is; scoring five there means the format
is proven *and* that the auction for attention is full.

### The recommendation is `goldscan`

Not the highest score. The best combination of three things:

1. **The output is a reveal.** "Is this real gold or plated?" is a question with
   a two-second answer and a face watching it arrive. That is the same shape as
   the looks-maxing apps the playbook was built on, and it needs no creator
   training to work — the format is the product.
2. **The intent is money, and money converts.** From the earlier research:
   CoinSnap earns **$2.00 per download** against Rock Identifier's $1.33 and
   Picture Insect's $1.25. The gap is not audience size, it is what the question
   is about. "What is this worth" outsells "what is this" by half again, and
   gold is the same question as coins.
3. **It is less crowded than the fives.** Hallmark identification is a real
   niche with real competitors, not a saturated one.

Against it, honestly: gold is used less often than a workout app, and the
identification is harder to be right about from a photo than a dog sitting down.
Both are reasons to probe it against real hallmarks before spending anything —
the same test §9 of the runbook demands of Dash Light, for the same reason.

`womensfit` is the other serious candidate and has one thing to fix first: the
listing promises 16 workouts and the pack ships 10.

## What this costs, said plainly

The playbook's numbers come with an operation attached: sourcing, an interview,
a training course with a quiz, and someone managing 200 people. That is a
full-time job and a payroll, not a weekend.

The stated path in is worth following exactly: **be the creator first.** Post
until something works, then bring on two to ten and train them against what
already worked, then scale only what is already converting. Skipping to 200
creators without a format that has worked once is paying to distribute
something that does not convert.

## What not to do, either way

- **No paid ads on Dash Light before §9.** The scanner has never been run
  against a photograph of a real dashboard. Buying traffic to an app that reads
  lights badly buys refunds and one-star reviews, and those are permanent.
- **No discount claims in the app.** A localised price is what the buyer sees;
  telling them it is a discount is a review finding.
- **No screen recordings as the hook.** A demo is watched by people who already
  want the product, which on a crisis app is nobody yet.
