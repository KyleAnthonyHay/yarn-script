### Your Task

- We want you to build an AI teleprompter React app.
- Teleprompters show a script in large text so they are easy to read back, and they typically scroll at a constant pace.
- We want you to build a teleprompter that scrolls automatically as you are reading it back.
- What the app might look like:
    - You have a text box where you can write a script or paste one in.
    - There’s a “Read back Script” button.
    - When you hit that button, then you display the script in large text. As you read out the script, the script should scroll as you are reading the script (i.e. by transcribing your speech).

---

### Some tricky parts

- This is a very latency sensitive product – as you read back at normal speed, the upcoming text should always be visible:
    - Also the text in the teleprompter should be large with only ~5 words per line (so that your eye doesn’t move too far to the left and right) and you can only have a max 4 lines.
    - This all means not that many words will appear on the screen at once, and you want to ensure the upcoming words are always visible.
- Users may not perfectly read back the script:
    - They might miss words out
    - They might ad-lib or interject phrases that are not in the original script
    - They might rephrase words or sections
- Your solution should both be very low-latency and support going off script.

---

### Deliverables

- Send a Loom video showing your solution working as well as the code to [nicole@yarn.so](mailto:nicole@yarn.so) along with a brief description of how it works and any thinking.
- Please take no longer than 4 hours to complete the assignment.
- You’ll also jump on a 10 minute call with a cofounder and an engineer here to discuss your solution.
- You’ll be paid $400 for completing the take home. Please send your Venmo with your submission
- Also please send over any expenses for services/compute required (e.g. for transcription or LLMs etc.)