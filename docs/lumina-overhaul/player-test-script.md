# Player test script: Lumina games on real phones

The real-player test from the overhaul report (`reports/Slot provider UI and motion.md`,
Part 7), ready to run with **10 people** on **their own phones**, with **play money** only.
About 25 minutes per person. One facilitator, one note-taker (or record the screen with the
player's permission).

## Before you start

- **Links.** The demo lobby (play money, nothing to sign up for). For the sub-stake test you
  need two links per game: the normal one, and the same one with `?market=UKGC` added
  (for example `…/classic/?market=UKGC`, `…/glasshouse/?market=UKGC`). The UK version shows a win at or below the bet as a
  plain credit, with no win sounds or effects.
- **Who.** Adults (18+) who have played a slot at least once in the last year. Mix ages and
  phone sizes. Nobody who works on the games. Pay a fixed thank-you (a coffee voucher, say),
  never anything tied to what they win in the demo.
- **What to say.** "This is play money. We are testing the games, not you. There are no wrong
  answers. Please think out loud." Do not explain any rules, buttons or features.
- **Phones.** Their own phone, held their own way. Sound on if they are happy with that.
- **Reset** the demo balance in the lobby between players.

## The six tests

Run them in this order. Use the score sheet at the end.

### 1. Cause and effect (the main test, about 10 min)

Goal: after three rounds, **at least 8 of 10** players explain a win correctly without help.

For each game (rotate the order between players):

1. Let them play three rounds on their own. Say nothing.
2. After any round that paid, ask: **"Why did you win that amount?"**
3. Then the game's own question:
   - **Vault 20K:** "What did the multiplier do?" (Correct: the multiplier plates add up,
     and the round's win is multiplied by the total; the board shows "win × total = total win".)
   - **Moth & Lantern:** "Which line paid, and why?" In free spins: "What did the ×3 do?"
     (Correct: names or points at the line; ×3 triples each line win.)
   - **Relic Forge:** "What is the bar at the top, and what fills it?" After a draft: "What
     did the relic you picked do?" (Correct: embers from wins fill the forge; when it is full
     the Forge starts; the relic changes the next boards.)
   - **Glasshouse:** after the first round with a beam: **"What did the light do?"** Do not
     say "beam", "wild" or "mirror" first. (Correct: the light starts at the lens on the left,
     the mirrors turn it, and the panes it crosses help make wins / stand in for symbols.
     "Partly" if they only say "it lit some panes".) **Pass mark for Glasshouse: 8 of 10
     explain the beam unprompted.** The beam is rare in the base game (about 1 spin in 33):
     if none has come by round 15, use the buy (100× the bet) and ask in the free spins,
     where it comes about 1 spin in 5.
4. When a feature starts (or use the buy in Vault 20K), after its intro panel ask: **"What is
   different in this feature?"** (Correct: Vault, multipliers add up for the whole bonus;
   Moth & Lantern, every win ×3; Relic Forge, you pick a relic before each spin; Glasshouse,
   lit panes stay lit for the next two spins.) After the
   outro: **"How much did the feature pay?"** (Correct: the outro's total.)
5. Score each answer **correct**, **partly**, or **wrong**. Write down their words.

A player passes a game when, by their third paying round, the answer is correct without a
hint.

### 2. Five-second recall (about 3 min)

1. Show the lobby tile of one Lumina game next to tiles of two well-known games from other
   studios (any two popular slots), for **5 seconds**, then hide the screen.
2. Ask: "Which one was the game you just played? What do you remember about it?"
3. Record: picked correctly yes/no, and the words they use (colour, character, name).

Repeat for each Lumina game, with different competitor tiles each time.

### 3. Thumb accuracy and reach (about 4 min)

1. Portrait first. Ask them to: spin, raise the bet two steps, lower it one, open the menu,
   close it, open game info, close it. Then turn the phone sideways and repeat.
2. Count **missed taps** (touched near a control and nothing happened, or hit the wrong one)
   for Spin, bet −/+, Menu, Info.
3. Note whether they find **left-hand mode** in the menu on their own, and whether they
   switch it on.

### 4. Speed preference (about 3 min)

1. In the normal (default-market) link, show where the speed button is, once.
2. Let them play 10 rounds however they like.
3. Record the speed they **end on** (normal, quick or turbo) and whether they changed it.

### 5. Sub-stake perception (about 4 min)

1. Give them 20 rounds in one build (half the players start with the normal link, half with
   the `?market=UKGC` link), then 20 rounds in the other.
2. After each block of 20, ask: **"Out of those 20 spins, how many times did you win more
   than you bet?"**
3. Write down their guess. The note-taker counts the real number (the Win readout against
   the Bet readout).

What we expect: guesses are higher, and further from the truth, in the normal build than in
the UK build (published research on "losses disguised as wins" predicts this). This is a
check of our design, not a claim about anyone's play.

### 6. Readability (about 2 min)

1. Ask: "Where is your balance?", "What is your bet?", and in the UK build, "How long have
   you been playing?" (the strip at the top). Time each answer from the question to the
   point; under **2 seconds** passes.
2. Show the 48 px grayscale symbol sheet (`docs/lumina-overhaul/img/symbols-48-grayscale.png`)
   on the phone. Point at four symbols in each row and ask them to name or describe each
   one. Note any two symbols they mix up.

### 7. One interface (about 2 min)

Show three screenshots of the control bar alone (the board cropped away), one per game, in a random order. Ask: **"Which game is each one from?"** The answer should be "I can't tell": the bar is the same in every Lumina game. Then ask them to change the bet and open the menu in the game they played least; note any hesitation.

## Score sheet (one per player)

| | Vault 20K | Moth & Lantern | Relic Forge | Glasshouse |
|---|---|---|---|---|
| 1. Explained a win by round 3 (correct / partly / wrong) | | | | |
| 1. Game question (correct / partly / wrong) | | | | |
| 1. Glasshouse: explained the beam unprompted (yes / partly / no) | — | — | — | |
| 2. Picked the tile in 5 s (yes / no) | | | | |
| 3. Missed taps, portrait | | | | |
| 3. Missed taps, landscape | | | | |
| 4. Speed they ended on | | | | |
| 5. Guess / real (normal build) | | | | |
| 5. Guess / real (UK build) | | | | |
| 6. Balance / bet / time found in < 2 s | | | | |
| 6. Symbols mixed up | | | | |

Also note: phone model, portrait or landscape by choice, left-hand mode used, sound on or off,
anything they said that surprised you.

## After the sessions

- **Pass marks:** cause and effect 8 of 10 per game (Glasshouse: 8 of 10 explain the beam unprompted); tile recall 7 of 10; fewer than one missed
  tap per player per orientation; balance and bet found in under 2 seconds by 9 of 10.
- Anything below a pass mark is a change to make before the next round of tests. Bring the
  sheets and notes back and we turn them into fixes.
- Keep the notes anonymous (first name or a number only). Delete screen recordings once the
  notes are written up.
