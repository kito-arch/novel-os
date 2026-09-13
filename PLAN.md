Yes. **This changes my recommendation quite a bit.** You're not really building a general “memory” product anymore. You're building a **voice-first writing/worldbuilding environment** where the AI maintains the internal state of a story as the writer creates it.

I would design it around that from day one.

## 1\. Don't have the LLM "organize notes"

Have it build a **story knowledge graph**.

The raw transcript is only the source material.

For example, the writer says:

> “Sarah walked into the old house in London at around midnight. She was scared because she'd been there before, but she couldn't remember why. John had told her never to come here. She didn't tell him that she had already found the key.”

You don't just save that as a note.

You extract structured facts:

```
SCENE
├── Location: Old House
├── City: London
├── Time: midnight
├── Character: Sarah
│   ├── emotion: afraid
│   ├── memory: has previously visited house
│   ├── missing_memory: reason for previous visit
│   └── knows: [???]
│
├── Character: John
│   ├── told Sarah: "Never come here"
│
├── Event
│   ├── Sarah entered Old House
│   ├── Sarah possesses Key
│   └── Sarah concealed this from John
│
└── Questions
    └── Why was Sarah previously here?
```

**That is your actual product.**

The transcript is merely evidence from which this structure is constructed.

---

# 2\. I'd use AssemblyAI only for STT

This is where you can keep your costs extremely low.

AssemblyAI currently lists async Universal-3.5 Pro at **$0.21/hour**, Universal-2 at **$0.15/hour**, while realtime Universal-3.5 Pro is $0.45/hour. Their billing is based on actual audio duration. AssemblyAI Frequently Asked Questions+1

For your product, I'd initially do:

**Microphone**

↓

**AssemblyAI STT**

↓

**Transcript**

↓

**Your organization pipeline**

Don't use AssemblyAI's full Voice Agent API for this. You're not building a conversational voice agent. You're building a transcription → knowledge extraction pipeline, and the bundled Voice Agent API is dramatically more expensive. AssemblyAI

---

# 3\. Don't send the entire novel to OpenAI every time

This is probably the most important architectural decision.

Imagine a writer has dictated **80,000 words**.

Then they say:

> "John visits Sarah's apartment and realizes she lied to him."

You don't send:

**80,000 words + new sentence → LLM**

Instead, maintain a structured database.

Something like:

```
Story
 ├── Characters
 ├── Locations
 ├── Events
 ├── Scenes
 ├── Objects
 ├── Relationships
 ├── Timeline
 ├── Knowledge
 ├── Goals
 ├── Fears
 ├── Secrets
 ├── Conflicts
 └── Drafts
```

When the new transcript comes in, retrieve only the **relevant context**.

For example:

```
New transcript:
"John visits Sarah's apartment..."

Relevant existing data:
- John
- Sarah
- Sarah's apartment
- Previous interaction between John/Sarah
- John's current goal
- Sarah's known secrets
- Current chapter
```

Then ask the model:

> Given this new information and these relevant existing entities, update the story state.

That dramatically reduces cost.

---

# 4\. Use a cheap model for extraction

You don't need your most powerful model for every utterance.

OpenAI's current API pricing makes this particularly attractive: GPT-5 nano is listed at **$0.05 / 1M input tokens and $0.40 / 1M output**, while GPT-5 mini is $0.25 / $2. OpenAI Developers+1

I'd create tiers:

### Cheap model

Use for:

- entity extraction
- classification
- detecting people/places
- extracting relationships
- extracting events
- updating attributes
- detecting dates/times
- basic deduplication

### Better model

Use for:

- resolving contradictions
- understanding complicated character motivations
- reconstructing timelines
- deciding whether two entities are actually the same
- complex story analysis

### Best model

Only use when the user explicitly asks:

> "Analyze Sarah's character."

> "Find plot holes."

> "What doesn't make sense in my story?"

> "Help me develop this chapter."

This keeps your **background processing cheap** while reserving expensive intelligence for things where the writer actually notices the difference.

---

# 5\. Make the output structured JSON

Don't ask:

> "Organize this note."

Instead give the model a schema.

Something roughly like:

```
{
  "entities": [],
  "events": [],
  "relationships": [],
  "knowledge_changes": [],
  "locations": [],
  "timeline_events": [],
  "character_changes": [],
  "open_questions": [],
  "story_facts": []
}
```

For a character:

```
{
  "character": "Sarah",
  "attributes": {
    "goals": [],
    "fears": [],
    "desires": [],
    "beliefs": [],
    "secrets": [],
    "knowledge": [],
    "relationships": [],
    "appearance": []
  }
}
```

The model shouldn't directly write to your database.

It should produce **proposed changes**.

Your application validates them and commits them.

That's important.

---

# 6\. You need a distinction between FACT and INFERENCE

This will be **critical** for a writing application.

Suppose the writer says:

> "Sarah walked into the room trembling."

You can safely record:

```
Sarah → was trembling
```

But you shouldn't automatically record:

```
Sarah → is afraid of the room
```

That's an inference.

Instead:

```
Observed:
Sarah was trembling.

Possible interpretation:
Sarah may be frightened.
```

Likewise:

> "John looked at Sarah suspiciously."

doesn't necessarily mean:

> John knows Sarah lied.

Your system needs to understand:

### Explicit

The writer directly stated it.

### Implied

Strongly suggested by the writing.

### Inferred

The AI believes it might be true.

### Unknown

The system doesn't know.

This will prevent your AI from **quietly rewriting the author's story canon.**

---

# 7\. Character knowledge should be its own system

This is where I think your idea gets really interesting.

Don't just have:

**Sarah knows X.**

Have:

```
Knowledge
    fact: John killed Michael
    known_by:
        Sarah
        John
    unknown_by:
        Michael
        David
```

And perhaps:

```
Sarah learned:
    fact: John killed Michael
    source: overheard conversation
    time: Chapter 8
```

Then you can eventually give the writer a feature:

> **"Does Sarah know this yet?"**

And the system can answer based on the story timeline.

Even better:

> **"Would Sarah realistically know that John is lying here?"**

That is genuinely useful for novelists.

---

# 8\. Track events, not just notes

Your underlying model should probably be **event-centric**.

For example:

```
EVENT #183

Who:
Sarah

Action:
Visited

Where:
Old House

When:
October 14, 11:48 PM

Why:
Unknown

Known motivation:
Investigating John's warning

Participants:
Sarah

Objects:
Old brass key

Consequences:
Sarah discovered photograph

Knowledge gained:
Sarah learned Michael had visited the house

Knowledge concealed:
Sarah did not tell John
```

Then you can reconstruct:

**character history**

**location history**

**timeline**

**relationships**

**plot progression**

from the events.

That's far more powerful than manually storing dozens of notes.

---

# 9\. Your UI could be incredible

Imagine the writer has a left sidebar:

```
MY NOVEL

📖 Manuscript

👤 Characters
   Sarah
   John
   Michael

📍 Locations
   London
   Old House
   Sarah's Apartment

🕐 Timeline

🎭 Relationships

🔑 Secrets

🧠 Knowledge

🎯 Goals

❓ Open Questions

🧩 Plot Threads
```

And the writer mostly stays in:

> **🎙️ Talk**

They dictate for 20 minutes.

When they're done, the application says:

> **Processed 1,840 words**
>
> Added:
>
> - 2 scenes
> - 3 events
> - 1 character
> - 2 locations
> - 4 character relationships
> - 7 story facts
> - 3 open questions
>
>   **⚠️ Possible contradiction**
>
> You previously established that Sarah had never met Michael. Today's dictation says Sarah recognized Michael's voice.

That's a killer feature.

---

# 10\. The "story debugger" could be your killer feature

Once you've accumulated enough structured information, you can do things normal writing software can't.

### Continuity

> "Sarah's eyes are described as green in chapter 2 but blue in chapter 14."

### Knowledge

> "John appears to know something that he shouldn't know until chapter 19."

### Timeline

> "Sarah is simultaneously described as being in London and Paris on Tuesday."

### Character motivation

> "You established that Sarah is terrified of water, but she's volunteered to swim across the lake without any explanation."

### Relationships

> "Sarah and John have not spoken since their argument, but the current chapter assumes they already reconciled."

### Unresolved threads

> "You introduced the mysterious photograph in Chapter 3 but haven't referenced it for 11 chapters."

**That's a much stronger product than AI transcription.**

---

# 11\. Economically, your architecture could look like this

```
                    🎙️
                 Writer
                    │
                    ▼
             AssemblyAI STT
                    │
                    ▼
              Raw Transcript
                    │
                    ▼
          Cheap LLM extraction
                    │
             ┌──────┴──────┐
             ▼             ▼
        Structured      Raw transcript
         changes             │
             │               │
             ▼               ▼
        Story Database    Search/archive
             │
             ▼
       Relevant context
             │
             ▼
      Complex LLM when needed
             │
       ┌─────┼─────┐
       ▼     ▼     ▼
    Writer  Story  Continuity
    Chat    Tools  Checker
```

---

# 12\. I'd actually start simpler than you think

Don't try to build the complete novelist operating system initially.

Your MVP could be:

### Screen 1 — Dictate

Big microphone.

Writer talks.

### Screen 2 — Story

Automatically extracted:

- Characters
- Locations
- Events
- Timeline
- Relationships

### Screen 3 — Character

For every character:

```
Sarah

Description
Goals
Fears
Beliefs
Secrets
Knowledge
Relationships
Appearances
Interactions
Timeline
```

### Screen 4 — Scene

```
Scene 12

Location
Time
Characters
What happened
What changed
Important objects
Knowledge gained
Goals
Conflict
```

And then one magical feature:

> **"Ask my story anything."**

That's enough for a very compelling first version.

---

## Cost-wise, this can be surprisingly cheap

Suppose a heavy user dictates **20 hours/month**.

At AssemblyAI's currently listed $0.21/hour async rate, that's only about **$4.20/month of STT**. AssemblyAI

The LLM organization layer could also be inexpensive if you're careful about what you send. For example, GPT-5 nano is currently listed at $0.05/1M input tokens and $0.40/1M output, while GPT-5 mini is $0.25/1M and $2/1M respectively. OpenAI Developers+1

So **the expensive part shouldn't be transcription**. Your main cost-control problem is preventing unnecessary LLM context and repeated processing.

I'd therefore optimize around:

**STT is cheap → extraction is cheap → retrieval is selective → deep reasoning is on-demand.**

---

## One architectural decision I'd make now

Don't make the database:

> `notes`

Make it:

> **`story_world`**

with entities such as:

```
Story
Character
Location
Object
Event
Scene
Chapter
Relationship
Fact
Knowledge
Goal
Fear
Secret
Interaction
TimelineEvent
PlotThread
```

Then your raw dictation is simply **evidence that modifies the story world**.

That gives you a very strong foundation for the product you're describing.

And honestly, I'd position this less as **“AI writing software”** and more as:

> **“The writing environment that remembers your entire story.”**

The writer can forget whether they mentioned something 40,000 words ago. **The software doesn't.**

That's the part I'd build the company around.
