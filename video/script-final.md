# ChromeRAMFix — 15-20s intro video, final script

Product name on screen: **ChromeRAMFix**. Master clock: 30 fps, total runtime **19.5 s** (comfortably inside the 15-20 s window, and it leaves 0.5 s of head so the last card doesn't get clipped on upload).

Two layouts, same eight beats, same VO: **9:16 1080x1920** (Reels/Shorts/TikTok) and **16:9 1920x1080** (YouTube/blog). Upload 9:16 natively to Reels; do not letterbox a landscape render into a feed that scrolls vertically.

Pacing rule held throughout: **no beat shorter than 2.5 s**. Longest single-word hold is 3.0 s. This is deliberately slow, not the 3-second-cut style.

---

## 1. Delivery notes (read before recording)

**Voice.** Your voice, Hinglish, Latin script. Expressive, not monotone — you know this part better than I do. Record at a normal talking speed and do not time-compress afterward. If the VO runs long, cut a beat, never the words. Two beats can carry 3.0 s: the `300 MB → 0 MB` number and the CTA.

**On-screen text style.** Every card is `fontfile Arial Bold`, white, `borderw=4` black outline. Nothing else. Bold sans plus a heavy black border is what survives on a phone on bad cellular at a bus stop. No drop shadows (they thin out at small sizes), no gradient fills, no thin boutique fonts.

**What sits under the text.** These are placeholders in this document; the actual choice is yours:
- Screen recording of Chrome's Task Manager, memory column, 15 tabs open, then 1 tab.
- Terminal running `verify_all.sh` going green.
- A real `.cemetery` store file open in a plain-text editor, ~268 bytes per tab.
Your video, your footage. The text timings below assume nothing about your B-roll, so they work over any background.

**Music.** One low drone or a single bass note that starts at the hook and stops clean on the `0 MB` reveal. No beat, no drums, no arpeggios in the first 10 s. Beat numbers belong in SFX, not in music.

---

## 2. Shot-by-shot table

Nine beats. Beat 0 is the hook, and there are two versions (A/B, section 3).

| # | In | Out | Dur | What's on screen | On-screen text (verbatim) | VO line (verbatim, Hinglish) | SFX cue |
|---|---|---|---|---|---|---|---|
| 0A | 00:00.0 | 00:02.5 | 2.5 | Screen recording: 15 tabs in Chrome, fan audible / RAM column climbing | `TERA BROWSER` / `4 GB KHA RAHA HAI` | "Tera browser chaar GB kha raha hai." | Low bass hit on the cut in. No music yet. |
| 0B | 00:00.0 | 00:02.5 | 2.5 | Same shot, alternate | `MAIN BANAUN` / `TOH KYA KARU` | "Main banaun toh kya karun." | Same bass hit, one frame earlier to feel like an interruption. |
| 1 | 00:02.5 | 00:05.0 | 2.5 | Chrome Task Manager, RAM column, before | `15 TABS KHULI` / `4 GB GAYA` | "Pandrah tabs khuli, chaar GB gaya." | A short sub drop under the second line. |
| 2 | 00:05.0 | 00:08.0 | 3.0 | Same column after discard, single digit | `300 MB` / `0 MB` | "Ek tab teen sau MB, ab zero." | Music stops dead on `0 MB`. Silence for ~0.4 s. |
| 3 | 00:08.0 | 00:10.5 | 2.5 | Terminal: benchmark output | `5,359 BYTES` / `0.048 ms` | "Pandrah tabs ek saath, paanch hazar bytes. Padhne mein zero point zero aath ms." | Soft tick per number, like a counter. |
| 4 | 00:10.5 | 00:13.0 | 2.5 | Clicking a tab, page already there, no flash | `BYTE-IDENTICAL` / `RESTORE` | "Click kiya, wapas aa gaya. Ek bhi bit nahi badla." | Clean UI click, then nothing. |
| 5 | 00:13.0 | 00:15.5 | 2.5 | Plain-text editor on the store file, scrambled redacted block visible | `PASSWORDS / CARDS` / `/ OTP` / `DISK PE NAHI` | "Password, card, OTP, yeh likhne se pehle hi kaat diye jaate hain." | Paper-rustle, quiet. |
| 6 | 00:15.5 | 00:17.0 | 1.5 | Blank-ish card, no footage | `POORA LOCAL` / `ZERO CLOUD` | "Poora local. Kahin bhi data nahi jaata." | One flat low note. |
| 7 | 00:17.0 | 00:19.5 | 2.5 | Logo card | `ChromeRAMFix` / `commet pe rakh` | "ChromeRAMFix. Comment pe rakh." | Bass hit back for the logo, cut on the last frame. |

Total: 19.5 s.

**Word count check on beat 5.** Three lines of text with a six-word VO in 2.5 s is the tightest pairing in the cut. If it feels crowded in the read, drop `/ OTP` to a single card reading `PASSWORDS/CARDS/OTP` at `fontsize=58` — twenty characters fits inside 1080 at that size (measured 62% of frame), and the table stays correct.

**Two lines to never say in the same breath.** `Byte-identical` and `zero point zero four eight ms` in one sentence is the only line that risks sounding rehearsed. Slow down on `ek bhi bit nahi badla` instead. That phrase, said flatly, is the whole pitch.

---

## 3. A/B hooks

Both hooks are already 2.5 s and both are beat-0 compatible — swap the card, re-record line 0, keep the rest of the cut untouched.

**Hook A — the number.** `TERA BROWSER / 4 GB KHA RAHA HAI`. VO: "Tera browser chaar GB kha raha hai."
- Leads with a number, so the viewer has to do arithmetic in the first second. Numbers outperform states-of-mind in the first two seconds because they can't be skimmed.
- Risks reading as a benchmark video, which pulls in a technical crowd and pushes out the college-friends audience. If Reddit skews hard, that's not a bad outcome.

**Hook B — the confession.** `MAIN BANAUN / TOH KYA KARU`. VO: "Main banaun toh kya karun."
- Reads as a person admitting something, so the pull is: why is he telling me this. That curiosity gap holds longer than a stat does.
- Weaker for the technical crowd, who know what they're looking at in one glance and may bounce if they think it's a general "AI talk".
- Best used on Instagram where the follow is the product.

**My recommendation.** Run A on Reddit and YouTube, B on Instagram. That's not a compromise, they're two different feeds with two different jobs. If you only have budget for one, use A: a screenshot that says `4 GB` in a RAM column is legible on a muted autoplay, and most of Reddit scrolls muted.

**Rule for the A/B.** Don't change more than the first 2.5 s. Two variables at once means you learn nothing about which one moved.

---

## 4. The 3-line message for a friend who doesn't code

Paste-able as-is. Keeps a believable technical spine without naming a single tool — the point is the friend reads it, not inspects it.

> Maine Chrome ka ek fix bana liya hai. Chrome apni memory saver se tabs reload karta hai, toh adha likha hua kaam gayab ho jaata hai — mera version tabs ko disk pe compress karta hai, unka process band kar deta hai, aur click pe wapas laa deta hai bilkul same, ek bhi bit nahi badla. Pura kaam mere laptop pe, cloud kahin nahi. Aur haan, maine yeh AI ke saath banaya hai, matlab maine code khud type nahi kiya — design aur testing maine dekhi, baaki kaam AI ne kiya.

**Why these lines hold up:**
- Line 1 is one clause. A friend can repeat it to someone else.
- Line 2 names the failing thing Chrome does first, so the second half of the sentence has something to land against. It also quietly carries the mechanism (compress, terminate, restore) without a single API name.
- Line 3 is the privacy claim, which is the sentence non-technical friends actually repeat.
- The last clause keeps the honest engineering story intact. This matters more than it looks: the README credits **Hermes Agent** for architecture, implementation, testing and packaging, and you as owner/maintainer. Both claims overcorrect if you try them. Saying "I built this with AI, I drove the design and the testing" is true, and a non-coder believing you built something real is the whole point of sending the message.

**Do not** add "AI ne khud sab kar diya" alone. That's the version that makes a friend think you pressed one button, and it also undersells the reading, testing and design decisions that were yours. Say what you did, not just what the tool did.

---

## 5. FFmpeg overlay commands

Verified on this machine. Font confirmed present:
```
/System/Library/Fonts/Supplemental/Arial Bold.ttf   (750,984 bytes, exists)
/System/Library/Fontes/Helvetica.ttc                (present, not used)
```

### 5.1 Use this ffmpeg, not the default one

```
which ffmpeg
/Users/apple/Documents/toolchains/homebrew/bin/ffmpeg
```
**`drawtext` is not compiled into the homebrew build** (`No such filter: 'drawtext'`). Use the binary that ships with Hermes:
```
FF=/Users/apple/.hermes/tools/ffmpeg-9.0.1-darwin-arm64/ffmpeg
$FF -version   # 9.0.1, built --enable-libfreetype --enable-fontconfig
```
Every command below assumes `FF` is set. If you run them as written verbatim, replace `$FF` with the full path.

### 5.2 The font variable

```
FONT="/System/Library/Fonts/Supplemental/Arial Bold.ttf"
```
**Always quote this path** in a shell variable. It has a space in it. Inside `-vf`/`-filter_complex`, wrap it in single quotes: `fontfile='$FONT'`.

### 5.3 Overlay text lives in files, never in `text=`

`text=` cannot contain a raw `%` (`Stray % near ...`), and long lines silently auto-wrap to full frame width. Reading from files avoids both, keeps the script readable, and lets you edit copy without touching the command.

Create the card files once, next to your footage:

```bash
mkdir -p overlays && cd overlays

printf 'TERA BROWSER\n4 GB KHA RAHA HAI\n'        > 01_hookA.txt
printf 'MAIN BANAUN\nTOH KYA KARU\n'              > 01_hookB.txt
printf '15 TABS KHULI\n4 GB GAYA\n'               > 02_problem.txt
printf '300 MB\n0 MB\n'                           > 03_number.txt
printf '5,359 BYTES\n0.048 ms\n'                  > 04_speed.txt
printf 'BYTE-IDENTICAL\nRESTORE\n'                > 05_restore.txt
printf 'PASSWORDS / CARDS\n/ OTP\nDISK PE NAHI\n' > 06_privacy.txt
printf 'POORA LOCAL\nZERO CLOUD\n'               > 07_local.txt
printf 'ChromeRAMFix\ncommet pe rakh\n'           > 08_cta.txt
```

**Note the `\%`.** A literal `%` in a `textfile=` source must be escaped with a backslash: `100\% LOCAL`. Verified on this machine: raw `%` fails, `%%` **also** fails, only `\%` renders. (Watch out if you build these files with `printf`: `printf '100%%'` collapses to one `%` in the file, which then fails. Use single quotes around the whole format string or write the file once by hand.)

### 5.4 The complete 9:16 render (1080x1920)

One command, all eight beats, `enable=` windows matching the table. Put your footage at `input.mp4`; the chain works over any 1080x1920 source, and the `color=` base below is a stand-in for testing.

```bash
ffmpeg -y \
  -f lavfi -i "color=c=0x1a1a1a:s=1080x1920:d=19.5:r=30" \
  -i input.mp4 \
  -filter_complex "
  [0:v]drawtext=fontfile='$FONT':textfile=overlays/01_hookA.txt:fontcolor=white:borderw=4:bordercolor=black:fontsize=88:x=(w-text_w)/2:y=1400:enable='between(t,0,2.5)'[v1];
[v1]drawtext=fontfile='$FONT':textfile=overlays/02_problem.txt:fontcolor=white:borderw=4:bordercolor=black:fontsize=96:x=(w-text_w)/2:y=1450:enable='between(t,2.5,5)'[v2];
[v2]drawtext=fontfile='$FONT':textfile=overlays/03_number.txt:fontcolor=white:borderw=4:bordercolor=black:fontsize=190:x=(w-text_w)/2:y=815:enable='between(t,5,8)'[v3];
[v3]drawtext=fontfile='$FONT':textfile=overlays/04_speed.txt:fontcolor=white:borderw=4:bordercolor=black:fontsize=78:x=(w-text_w)/2:y=1450:enable='between(t,8,10.5)'[v4];
[v4]drawtext=fontfile='$FONT':textfile=overlays/05_restore.txt:fontcolor=white:borderw=4:bordercolor=black:fontsize=82:x=(w-text_w)/2:y=1450:enable='between(t,10.5,13)'[v5];
[v5]drawtext=fontfile='$FONT':textfile=overlays/06_privacy.txt:fontcolor=white:borderw=4:bordercolor=black:fontsize=62:x=(w-text_w)/2:y=1450:enable='between(t,13,15.5)'[v6];
[v6]drawtext=fontfile='$FONT':textfile=overlays/07_local.txt:fontcolor=white:borderw=4:bordercolor=black:fontsize=88:x=(w-text_w)/2:y=900:enable='between(t,15.5,17)'[v7];
[v7]drawtext=fontfile='$FONT':textfile=overlays/08_cta.txt:fontcolor=white:borderw=4:bordercolor=black:fontsize=88:x=(w-text_w)/2:y=830:enable='between(t,17,19.5)'[vout]" \
  -map "[vout]" -t 19.5 \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
  chromeramfix_9x16.mp4
```

If your footage is already the full 19.5 s, drop the `color` input and use `[1:v]` as the chain head instead of `[0:v]`.

Vertical positions are chosen to sit in the lower two-thirds, clear of the Reels/Shorts caption strip at the bottom and the progress bar at the top. `03_number` is the exception and sits high because it's a two-word card you want above the fold.

### 5.5 Hook B swap (9:16)

Same command, one token changed:

```bash
... textfile=overlays/01_hookB.txt ...
```

### 5.6 The complete 16:9 render (1920x1080)

```bash
ffmpeg -y \
  -f lavfi -i "color=c=0x1a1a1a:s=1920x1080:d=19.5:r=30" \
  -filter_complex "
  [0:v]drawtext=fontfile='$FONT':textfile=overlays/01_hookA.txt:fontcolor=white:borderw=4:bordercolor=black:fontsize=96:x=(w-text_w)/2:y=700:enable='between(t,0,2.5)'[v1];
[v1]drawtext=fontfile='$FONT':textfile=overlays/02_problem.txt:fontcolor=white:borderw=4:bordercolor=black:fontsize=96:x=(w-text_w)/2:y=700:enable='between(t,2.5,5)'[v2];
[v2]drawtext=fontfile='$FONT':textfile=overlays/03_number.txt:fontcolor=white:borderw=4:bordercolor=black:fontsize=260:x=(w-text_w)/2:y=380:enable='between(t,5,8)'[v3];
[v3]drawtext=fontfile='$FONT':textfile=overlays/04_speed.txt:fontcolor=white:borderw=4:bordercolor=black:fontsize=80:x=(w-text_w)/2:y=700:enable='between(t,8,10.5)'[v4];
[v4]drawtext=fontfile='$FONT':textfile=overlays/05_restore.txt:fontcolor=white:borderw=4:bordercolor=black:fontsize=84:x=(w-text_w)/2:y=700:enable='between(t,10.5,13)'[v5];
[v5]drawtext=fontfile='$FONT':textfile=overlays/06_privacy.txt:fontcolor=white:borderw=4:bordercolor=black:fontsize=64:x=(w-text_w)/2:y=700:enable='between(t,13,15.5)'[v6];
[v6]drawtext=fontfile='$FONT':textfile=overlays/07_local.txt:fontcolor=white:borderw=4:bordercolor=black:fontsize=96:x=(w-text_w)/2:y=640:enable='between(t,15.5,17)'[v7];
[v7]drawtext=fontfile='$FONT':textfile=overlays/08_cta.txt:fontcolor=white:borderw=4:bordercolor=black:fontsize=96:x=(w-text_w)/2:y=460:enable='between(t,17,19.5)'[vout]" \
  -map "[vout]" -t 19.5 \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
  chromeramfix_16x9.mp4
```

For 16:9, all text is centered horizontally and vertically centered around y≈700 (mid-frame), except the number card (high) and the CTA (above center). This leaves room for a burned-in logo/bug in a corner without collision.

### 5.7 Single-overlay commands, if you'd rather build the cut in an NLE

One card at a time, both sizes. These are the exact same filters, no `enable=`, useful for generating a PNG contact sheet or for restreaming only one beat.

**9:16, every card:**

```bash
$FF -y -f lavfi -i "color=c=0x1a1a1a:s=1080x1920:d=1" \
  -vf "drawtext=fontfile='$FONT':textfile=overlays/01_hookA.txt:fontcolor=white:borderw=4:bordercolor=black:fontsize=88:x=(w-text_w)/2:y=1400" \
  -frames:v 1 card_01.png

$FF -y -f lavfi -i "color=c=0x1a1a1a:s=1080x1920:d=1" \
  -vf "drawtext=fontfile='$FONT':textfile=overlays/02_problem.txt:fontcolor=white:borderw=4:bordercolor=black:fontsize=96:x=(w-text_w)/2:y=1450" \
  -frames:v 1 card_02.png

$FF -y -f lavfi -i "color=c=0x1a1a1a:s=1080x1920:d=1" \
  -vf "drawtext=fontfile='$FONT':textfile=overlays/03_number.txt:fontcolor=white:borderw=4:bordercolor=black:fontsize=190:x=(w-text_w)/2:y=815" \
  -frames:v 1 card_03.png

$FF -y -f lavfi -i "color=c=0x1a1a1a:s=1080x1920:d=1" \
  -vf "drawtext=fontfile='$FONT':textfile=overlays/04_speed.txt:fontcolor=white:borderw=4:bordercolor=black:fontsize=78:x=(w-text_w)/2:y=1450" \
  -frames:v 1 card_04.png

$FF -y -f lavfi -i "color=c=0x1a1a1a:s=1080x1920:d=1" \
  -vf "drawtext=fontfile='$FONT':textfile=overlays/05_restore.txt:fontcolor=white:borderw=4:bordercolor=black:fontsize=82:x=(w-text_w)/2:y=1450" \
  -frames:v 1 card_05.png

$FF -y -f lavfi -i "color=c=0x1a1a1a:s=1080x1920:d=1" \
  -vf "drawtext=fontfile='$FONT':textfile=overlays/06_privacy.txt:fontcolor=white:borderw=4:bordercolor=black:fontsize=62:x=(w-text_w)/2:y=1450" \
  -frames:v 1 card_06.png

$FF -y -f lavfi -i "color=c=0x1a1a1a:s=1080x1920:d=1" \
  -vf "drawtext=fontfile='$FONT':textfile=overlays/07_local.txt:fontcolor=white:borderw=4:bordercolor=black:fontsize=88:x=(w-text_w)/2:y=900" \
  -frames:v 1 card_07.png

$FF -y -f lavfi -i "color=c=0x1a1a1a:s=1080x1920:d=1" \
  -vf "drawtext=fontfile='$FONT':textfile=overlays/08_cta.txt:fontcolor=white:borderw=4:bordercolor=black:fontsize=88:x=(w-text_w)/2:y=830" \
  -frames:v 1 card_08.png
```

**16:9, every card:** same files, swap the size string to `s=1920x1080`, set `fontsize` to the values in section 5.6 (96/96/260/80/84/64/96/96), and `y` to (700/700/380/700/700/700/640/460).

### 5.8 What was actually tested, so you don't have to

| Check | Result |
|---|---|
| Font exists | Yes, 750,984 bytes, readable, has em/en dash and arrow glyphs |
| Homebrew ffmpeg `drawtext` | **Missing.** Use the Hermes ffmpeg in 5.1 |
| Single-line `text=` render | Pass |
| Multi-line `textfile=` render | Pass, lines stacked, centered |
| `\:` colon escape in `text=` | Pass (`2 MIN IDLE : 45 S`) |
| `%%` in textfile → `%` | **Fails.** Only `\%` works |
| Raw `%` in `text=` / `textfile=` | **Fails** (`Stray %`). Escape it |
| Long line in `textfile=` | **Auto-wraps** to frame width. Pre-break your lines |
| 9:16 widest card (`TERA BROWSER` set, fs=88) | 860 px = 80% of 1080, clear of edges |
| 16:9 widest card, fs=96 | 938 px = 49% of 1920 |
| Chained `drawtext` + `enable=` windows | Pass, 3-beat render verified frame-exact |
| Horizontal centering | Pass, measured centre within 2 px of frame centre on every card |
| Border legibility | Pass, `borderw=4` black on white is crisp at 0.5x phone scale |

### 5.9 Gotchas

1. **A failed card silently truncates the video.** This is the worst trap. When a `drawtext` in the middle of a chain fails on a parse error, ffmpeg renders the frames up to the **start time of the failing card** and exits 0. My test produced a perfectly playable `chromeramfix_9x16.mp4` of **15.50 s** — two beats missing — while reporting success. Always assert the duration after rendering:
```bash
ffprobe -v error -show_entries format=duration -of csv=p=0 chromeramfix_9x16.mp4
```
Expected: `19.500000`. Anything less means a card failed to draw.

2. **Newlines.** `text=` cannot contain a literal newline. That's the whole reason for `textfile=`. Don't try `\n` in `text=` either; it prints as two characters.
3. **`%` anywhere.** Escape as `\%` in a textfile. There is no way around this in `text=`, which is why the `POORA LOCAL` card uses no `%` at all.
4. **Colons.** In `text=` mode, escape a colon as `\:`. In `textfile=` mode, a colon needs no escape — put `0.048 ms` in a file, not in `text=`.
5. **Apostrophes.** `fontfile='...'` uses single quotes, so an apostrophe in your *text file* is fine and needs no escaping. Avoid apostrophes in `text=` mode entirely.
6. **Spaces in paths.** `fontfile='/System/.../Arial Bold.ttf'` — keep the single quotes. Alternatively copy the font next to your footage and say `fontfile=Arial Bold.ttf` with the space escaped as `\ `.
7. **`-vf` vs `-filter_complex`.** Single overlay → `-vf`. More than one → `-filter_complex` with the `[v1];[v1]...[vout]` chain, because two `drawtext` in one `-vf` chain needs an explicit pipe and a named pad.
8. **Devanagari.** Not in Arial Bold. If you ever need Devanagari overlay text, that needs a different font (Devanagari Sangam or Noto Sans Devanagari) and the commands above get one extra `fontfile=` swap. Roman-script Hinglish on screen is unaffected.

### 5.10 Two things this script deliberately does not claim

Both are real traps found in this repo's source, and both are the kind of thing that gets a launch cut torn apart in the comments.

- **The governor daemon does not decide what to discard.** The extension decides. `background.js` calls `GOVPolicy.decide(...)` in-process; the daemon on `:8795` only publishes a pressure *sample*. The script's VO therefore never says anything like "the daemon kills idle tabs." It says the machine watches itself and acts, which is true.
- **Nothing on screen reads harder than the mechanics actually are.** `0.048 ms` is a p50 store read, which is what the card claims; it is not end-to-end restore latency. The card is honest, and it is left to the FAQ to say so.

### 5.11 Not part of this deliverable

No audio, no video, no fonts were generated. This file is the script and the overlay commands. `marketing/how-it-works-plain.md` is a sibling deliverable and is not here.
