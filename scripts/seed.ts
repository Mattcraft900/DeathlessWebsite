import "dotenv/config";
import bcrypt from "bcryptjs";
import { generateKeyBetween } from "fractional-indexing";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { db, pool } from "../src/db/index.js";
import { blocks, characters, entries, writers } from "../src/db/schema.js";
import travelogueData from "./data/travelogue.json" with { type: "json" };

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

type TravelogueSession = {
  session_date: string;
  content: { game_date: string | null; text: string[] }[];
};

type CharacterSeed = {
  name: string;
  full_name: string;
  gender: string;
  species: string;
  age: string;
  category: string;
  snippet: string;
  description: string[];
  player?: string;
  level?: number;
  classes?: { class: string; level: number; subclass?: string }[];
  location_home?: string;
  location_last?: string;
};

const WRITER_DEFS = [
  { slug: "lucy", displayName: "Lucy", cssClass: "voice-lucy", isAdmin: true },
  { slug: "nemah", displayName: "Nemah", cssClass: "voice-nemah", isAdmin: false },
  { slug: "luark", displayName: "Luark", cssClass: "voice-luark", isAdmin: false },
  { slug: "enza", displayName: "Enza", cssClass: "voice-enza", isAdmin: false },
  { slug: "chesco", displayName: "Chesco", cssClass: "voice-chesco", isAdmin: false },
  { slug: "dm", displayName: "DM", cssClass: "voice-dm", isAdmin: false },
] as const;

const CHARACTER_DATA: CharacterSeed[] = [
  {
    name: "Lucy",
    full_name: "Lucy",
    gender: "female",
    species: "human",
    age: "20-ish",
    category: "party",
    snippet: "Level 6 Warlock of the Fiend",
    description: [
      "That's me! Yours truly. I don't have a last name. Or a birthday. <It was somewhere around September, 20 years ago from what I can guess> I guess that's because I grew up on the streets of New Haven with my brother. We didn't have parents, but we did fine for ourselves. We were happy. It was the only life I ever knew, at least until...",
      "",
      "I'll come back to this one later maybe",
      "<Lucy is a great addition to the team and the only one who seems to care how everyone else is doing. She is a light to our otherwise somber party. I know she's been through a lot that none of us can truly understand with the shroud, but I hope she knows she's safe with us and that nothing— not even death— can stop us from trying to help her get back what she has lost.>",
    ],
    player: "Matthew",
    level: 6,
    classes: [{ class: "warlock", level: 6, subclass: "the fiend" }],
  },
  {
    name: "Nemah",
    full_name: "Nemah",
    gender: "female",
    species: "valcari",
    age: "14",
    category: "party",
    snippet: "Level 6 Necro-alchemist Artificer",
    description: [
      "Nemah is the best! She's so sweet, she's like a sister I never had. On the outside she looks real scary-like, what with her bein' a super tall Valcari lady with four arms and a mask that she always wears. Well, not always, but she wears it a lot. I still have to ask her about that, actually. Oh, and she's like, an albino (I think that's what she said)? <Yes.> Which means her skin is all pale and white when normally it should be like black or brown, I think. But she looks super cool though.",
      "<We wear the masks as a way to ward off evil spirits and as a sign of protection. We only take them off as a sign of respect or when in the company of those we trust.>",
      "But on the inside, Nemah is just the sweetest, most caring-est lady you ever did meet! She usually stays pretty quiet but once you get to know her she's so cool! She's told me all kinds of stories, especially about when she was studyin'... something at Shen Ora University! She had this one professor who she really respected, but all I know about him is that he didn't want her to start practicing fleshcraft I guess.",
      "Oh right, and Nemah does fleshcraft! It's… not very fun to think about, actually. But it's cool how smart she is that she can do it! The first time I saw her, actually, she used her knowledge to heal my eye, so I know it can't be all bad. That's also where her two extra arms come from. They used to belong to a hobgoblin and a bugbear, and I think she's told me that their voices are in her head sometimes?",
      "<They can be quite annoyi` F*** YOU LONGLEGS!!>",
      "The point is, Nemah cares a lot about the people she's around. You might miss it if you're not paying attention, since she's so quiet and all, and her huge glaive on her back is kinda intimidatin', but she really watches out for us. ",
      "Nemah is from somewhere on the other side of Widow's Run. She says she left to go find a way to cure some kinda bad disease that was getting to everyone in her tribe, and I think that's what led her to study at the university? I'm not super clear on the details. Oh and speaking of disease! Nemah has a sorrow that makes her feel sick all the time. Maybe that's part of why she's so quiet, actually. Either way, whenever we get attacked, she kinda… lets it out? Or something? It's kinda extremely terrifying. So I'm glad she's on our side! Well, even more glad, I should say. :)",
    ],
    player: "Kiera",
    level: 6,
    classes: [{ class: "artificer", level: 6, subclass: "necro-alchemist" }],
  },
  {
    name: "Luark",
    full_name: "Luark Lancaster",
    gender: "male",
    species: "kindred",
    age: "376",
    category: "party",
    snippet: "Level 6 Investigator Rogue",
    description: [
      "Okay, so I'm pretty sure my friend Pill has told me that there like, at least a couple of books that've been written about Luark already, so I might not need to say all that much here, but it wouldn't feel right if I left him out. And besides, maybe the books are wrong, so I'm gonna write about him anyway!",
      "Luark is a kindred with purple skin. He's from Desolaria, which is across the ocean, and they do a lot of things kinda differently there. But also Luark is just kinda different in general anyway because he's like three hundred and fifty years old, which is more than a hundred! <Yes, it's at least 3 one-hundreds> He's done basically everything before, like being a lawyer, a professor, an author, and a bunch of other stuff, but right now he's a detective, which he says he likes the most. So Luark is really smart, but in a different way than Nemah.",
      "Except unlike her, he doesn't seem to like the fact that he's smart? At least, he gets really sad whenever he talks about all that stuff he's done. Well, actually, he brightens up a bit, and THEN he gets all sad. Those are the only times I think I've seen him smile. It's just a little bit, but it's there.",
      "He also has a family. Like not parents and siblings but like -- okay no he has those too, but like, he has a wife and a daughter. Desora and Winota. I still don't really know most of the details, but he got thrown out of Desolaria like 70 years ago because of something that he did -- not a bad thing, but something that one of his enemies could use against him to get him thrown out. It was pretty soon after his daughter was born, too. He really wants to see them again. Like, I think marriage works a little differently in Desolaria or something, because you can tell by the way he acts when he talks about his wife, Luark really really REALLY loves her, like she's the only woman in the world. It's real sweet. But it also hurts him a lot. I hope we can help him reunite with them soon.",
      "<From what I understand, he accused the wrong man of being a serial killer by mistake and that man was executed before it was revealed he was not actually the killer. Then he was on the run for a bit before ending up on some black train for 50 years and then ending up here. Now, he's following clues that have presented themselves that may help him find the true killer.>",
    ],
    player: "Logan",
    level: 6,
    classes: [{ class: "rogue", level: 6, subclass: "investigator" }],
  },
  {
    name: "Enza",
    full_name: "Enzalotl Xohecle",
    gender: "male",
    species: "ambystomin",
    age: "27",
    category: "party",
    snippet: "Level 6 Gunslinger Ranger",
    description: [
      "Enza is an ambystoman with blue skin, <Not as blue anymore.> and he's a little over three feet tall. He also black veins (which I learned recently is not normal) and is starting to go deaf and blind, which are both because of his sorrow. He also releases mist in the air sometimes; I think it's whenever he's stressed out. <Which is all the time.>",
      "Enza is from a town called Saint Dane, where he grew up on a farm. He really wants to make his parents proud and be a hero, but I can tell he's… afraid that he'll never do it, I guess. Even though he's probably the bravest one out of all of us, and we've tried to tell him, but he hasn't been havin' any of it, yet. I think it's got something to do with him workin' for the goblin mafia a little while back, because after he shot the Benedetti… leader guy, he ran away and never went back home, so until recently, he hadn't seen his family for 15 whole years. <There will be blood on their behalf.>",
      "Enza's got such a big heart, though. You can see pretty easy how much he struggles with his fears, but I've rarely seen him run from anything. In fact, he's usually the first one to speak up or step in when we find something bad going on. He doesn;t want to accept it yet, but I can see a natural leader in him, probably even more than Luark. He'll get there… I hope.",
      "Oh, and one last you gotta know about Enza:: he's got an adorable little mastiff named Luth! <He hates me.> Actually, I guess he's maybe little to me and Nemah and Luark, but to Enza (and Chesco I guess?) Luth is actually big enough for him to ride on. I'm not sure if Luth is a real dog or some kinda fey something-or-other, but either way, he's a real cutie and as loyal as they come. (I think there's some kind of god involved maybe? But like. Whatever.)",
    ],
    player: "Brennen",
    level: 6,
    classes: [{ class: "ranger", level: 6, subclass: "gunslinger" }],
  },
  {
    name: "Chesco",
    full_name: "Franchesco Guiseppe Benedetti III",
    gender: "male",
    species: "goblin",
    age: "11",
    category: "party",
    snippet: "Level 6 Bard/Cleric",
    description: [
      "Oh, Chesco.  <Oh indeed.>",
      "Chesco actually has a really long name but I can never remember even the first part of it. <Franchesco Giuseppe Benedetti III> We all just call him Chesco. He's a goblin a little over three feet tall who carries his banjo with him everywhere. Sometimes he plays it, and he's actually pretty dang good with it! I don't know why he doesn't play it more often. There's a lot of things I don't know about Chesco, actually; but for once, I don't think I'm the odd one out in that regard.",
      "The only thing that's perfectly clear about Chesco's life in the past is that it was… not pretty, to say the least. He grew up in the Brute Squad, in the Benedetti family, and from the snippets he throws out here and there it sounds like he was kinda hated by everyone. Except, maybe he had a friend named Buddy? He mentions him pretty often at least, but then again, Chesco also says he talks to Zol all the time, so… it can be kinda hard to know what's true that comes out of his mouth. <Buddy was a pseudonym for himself and the real name of a goblin he met in a library.>",
      "And boy, does a lot come out of his mouth. He sure does like to talk. And he's pretty annoyingly good at saying absolutely nothing when he does it, too. <Yup.>",
      "At first you would think that he's just an insane person, but you learn pretty quick that's not true. I've been around insane people before, and Chesco is too… consistent for that. I've also seen him when he's alone, and he doesn't talk to himself like the chatty kind of insane person does. He's usually silent as the stones, actually. When he is in a conversation, he makes off-kilter comments in a way that a young boy would, but he doesn't laugh at them. In fact, I don't think I've ever seen Chesco laugh at all, even though he's wearin' a big grin most of the time. And occasionally his off-kilter comments are just a casual mention of some horrible detail about his life, like that he's been addicted to drugs for most of it or that everyone in his family used him as a punching bag. <I will strangle his entire family when the opportunity presents itself.>",
      "Plus, weird stuff is always happening with Chesco. Like, weirder stuff than the rest of us, even. Pretty often he'll wander off and get lost only to return a few hours later, and there's always something weird about it that he doesn't like to talk about. Like, all of his stuff will have algae growing on it or he'll have new weird magic following him and say it's from Zol or something. <He is favoured in some way I don't yet understand.>",
    ],
    player: "Becca",
    level: 6,
    classes: [
      { class: "bard", level: 5, subclass: "???" },
      { class: "cleric", level: 1, subclass: "death" },
    ],
  },
  {
    name: "Pill",
    full_name: "Pill",
    gender: "female",
    species: "drow kindred",
    age: "25 (extremely young for a kindred)",
    category: "opc",
    snippet: "Old Black Train survivor and Luark's #1 fan",
    description: [
      "Pill is so cute! I haven't actually talked to her all that much, but she's basically the little sister I never had. We're magic pen pals with each other. She's actually older than me because she's a kindred (dark-skinned though, not like Luark), but she's still like, really young in kindred years, so. It still counts.",
      "Oh and speaking of Luark, she's kind of super obsessed with him. Like maybe to an unhealthy degree. But I think she's harmless, herself. She's just so honest and openhearted. Maybe other people find it annoying, but I think it's wonderful.",
      "She's good friends with Telken, and I think they met on some kind of weird train? And the train has something to do with Luark, too. No idea what that's about. Add it to the list of things I haven't had the chance to ask about, I guess.",
    ],
    player: "Becca",
    location_home: "A base camp somewhere in the Ruined Fields",
    location_last: "Refugee camp outside Sundown City",
  },
  {
    name: "Telken",
    full_name: "Telken",
    gender: "male",
    species: "half-kindred",
    age: "55 (looks much younger, though)",
    category: "opc",
    snippet: "Old Black Train survivor and Pathlighter",
    description: [
      "Now, I need to make something clear. Telken is a good person. He's a religious man – called a Wayfinder <pathlighter> or something – but you can tell that he cares about people. He's a really good friend to Pill, so credit where credit is due.",
      "I'm still learning about what exactly it is that they do, but we met Telken and Pill in the big refugee camp outside Sundown City, but they have some kind of base set up in the Ruined Fields helping people.",
      "With all that said… I don't like him! He just gives me the creeps, I don't know. He cares a little TOO much, maybe. Something about him being a priest means he can see my… condition, and he's a little uppity about not being able to help. It makes me feel weird.",
      "<He's out to convert people, that's all they do. Missionaries.>",
    ],
    player: "Brennen",
    location_home: "A base camp somewhere in the Ruined Fields",
    location_last: "Refugee camp outside Sundown City",
  },
];

const PARTY_WRITER_SLUG: Record<string, string> = {
  lucy: "lucy",
  nemah: "nemah",
  luark: "luark",
  enza: "enza",
  chesco: "chesco",
};

function slugify(name: string): string {
  return name.trim().toLowerCase();
}

function parseDateKey(
  gameDate: string | null,
  sessionDate: string,
): { dateKey: string | null; showHeading: boolean; title: string | null } {
  if (sessionDate === "Prologue" && (!gameDate || !gameDate.trim())) {
    return { dateKey: "prologue", showHeading: false, title: "Prologue" };
  }
  if (!gameDate || !gameDate.trim()) {
    return { dateKey: null, showHeading: false, title: null };
  }
  const match = gameDate.match(/(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/);
  if (match) {
    const month = match[1].padStart(2, "0");
    const day = match[2].padStart(2, "0");
    const year = match[3];
    return {
      dateKey: `${year}-${month}-${day}`,
      showHeading: true,
      title: gameDate,
    };
  }
  return {
    dateKey: gameDate.toLowerCase().replace(/\s+/g, "-"),
    showHeading: true,
    title: gameDate,
  };
}

function parseVoiceBlocks(text: string): { writerSlug: "lucy" | "nemah"; body: string }[] {
  const rawParts: { writerSlug: "lucy" | "nemah"; body: string }[] = [];
  const regex = /<([^>]+)>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index).trim();
    if (before) rawParts.push({ writerSlug: "lucy", body: before });
    const nemahText = match[1].trim();
    if (nemahText) rawParts.push({ writerSlug: "nemah", body: nemahText });
    lastIndex = regex.lastIndex;
  }

  const after = text.slice(lastIndex).trim();
  if (after) rawParts.push({ writerSlug: "lucy", body: after });

  const merged: { writerSlug: "lucy" | "nemah"; body: string }[] = [];
  for (const part of rawParts) {
    const prev = merged[merged.length - 1];
    if (prev && prev.writerSlug === part.writerSlug) {
      prev.body = `${prev.body} ${part.body}`;
    } else {
      merged.push({ ...part });
    }
  }
  return merged.filter((p) => p.body.length > 0);
}

function rankSequence(count: number, after: string | null = null): string[] {
  const ranks: string[] = [];
  let prev = after;
  for (let i = 0; i < count; i++) {
    const next = generateKeyBetween(prev, null);
    ranks.push(next);
    prev = next;
  }
  return ranks;
}

async function clearData() {
  await pool.query("TRUNCATE blocks, entries, characters, writers RESTART IDENTITY CASCADE");
}

function copyImages() {
  const oldImagesDir = resolve(
    root,
    "..",
    "..",
    "School",
    "WDD131",
    "final-project",
    "images",
  );
  const publicImages = resolve(root, "client", "public", "images");
  const charImages = resolve(publicImages, "characters");

  mkdirSync(charImages, { recursive: true });
  mkdirSync(publicImages, { recursive: true });

  const partySlugs = ["lucy", "nemah", "luark", "enza", "chesco"];
  for (const slug of partySlugs) {
    const pairs = [
      { srcName: `${slug}.jpg`, destName: `${slug}-full.jpg` },
      { srcName: `${slug}-small.jpg`, destName: `${slug}-small.jpg` },
    ];
    for (const { srcName, destName } of pairs) {
      const src = resolve(oldImagesDir, srcName);
      const dest = resolve(charImages, destName);
      if (existsSync(src)) {
        copyFileSync(src, dest);
        console.log(`Copied ${destName}`);
      } else {
        console.warn(`Missing ${srcName} (looked in ${oldImagesDir})`);
      }
    }
  }

  for (const file of ["graveyard.jpg", "deathless_symbol.png"]) {
    const src = resolve(oldImagesDir, file);
    const dest = resolve(publicImages, file);
    if (existsSync(src)) {
      copyFileSync(src, dest);
      console.log(`Copied ${file}`);
    } else {
      console.warn(`Missing ${file} (looked in ${oldImagesDir})`);
    }
  }
}

async function seed() {
  const defaultPin = process.env.SEED_DEFAULT_PIN || "deathless";
  const pinHash = await bcrypt.hash(defaultPin, 10);

  await clearData();
  copyImages();

  const writerIds = new Map<string, string>();
  for (const def of WRITER_DEFS) {
    const [row] = await db
      .insert(writers)
      .values({
        slug: def.slug,
        displayName: def.displayName,
        pinHash,
        cssClass: def.cssClass,
        isAdmin: def.isAdmin,
      })
      .returning({ id: writers.id });
    writerIds.set(def.slug, row.id);
  }

  const lucyId = writerIds.get("lucy")!;
  const nemahId = writerIds.get("nemah")!;

  const charRanks = rankSequence(CHARACTER_DATA.length);
  const characterIds = new Map<string, string>();

  for (let i = 0; i < CHARACTER_DATA.length; i++) {
    const c = CHARACTER_DATA[i];
    const slug = slugify(c.name);
    const writerSlug = PARTY_WRITER_SLUG[slug];

    const [row] = await db
      .insert(characters)
      .values({
        slug,
        name: c.name,
        fullName: c.full_name,
        gender: c.gender || null,
        species: c.species || null,
        age: c.age || null,
        category: c.category,
        snippet: c.snippet || null,
        writerId: writerSlug ? writerIds.get(writerSlug) ?? null : null,
        level: c.level ?? null,
        classesJson: c.classes ? JSON.stringify(c.classes) : null,
        playerName: c.player ?? null,
        locationHome: c.location_home ?? null,
        locationLast: c.location_last ?? null,
        sortRank: charRanks[i],
      })
      .returning({ id: characters.id });

    characterIds.set(slug, row.id);

    const joinedDesc = c.description.join("\n\n").trim();
    if (joinedDesc) {
      const voiceBlocks = parseVoiceBlocks(joinedDesc);
      if (voiceBlocks.length > 0) {
        const [bioEntry] = await db
          .insert(entries)
          .values({
            type: "character_bio",
            characterId: row.id,
            sortRank: generateKeyBetween(null, null),
            showHeading: false,
          })
          .returning({ id: entries.id });

        const blockRanks = rankSequence(voiceBlocks.length);
        await db.insert(blocks).values(
          voiceBlocks.map((b, idx) => ({
            entryId: bioEntry.id,
            writerId: b.writerSlug === "nemah" ? nemahId : lucyId,
            body: b.body,
            sortRank: blockRanks[idx],
          })),
        );
      }
    }
  }

  const travelogue = travelogueData as TravelogueSession[];
  let sessionPrevRank: string | null = null;
  let lastDateKey: string | null = null;

  for (const session of travelogue) {
    const sessionRank = generateKeyBetween(sessionPrevRank, null);
    sessionPrevRank = sessionRank;

    const [sessionEntry] = await db
      .insert(entries)
      .values({
        type: "travelogue_session",
        title: session.session_date,
        sortRank: sessionRank,
        showHeading: true,
      })
      .returning({ id: entries.id });

    let datePrevRank: string | null = null;

    for (const item of session.content) {
      const parsed = parseDateKey(item.game_date, session.session_date);
      let dateKey = parsed.dateKey;
      let showHeading = parsed.showHeading;
      let title = parsed.title;

      if (dateKey === null && lastDateKey) {
        dateKey = lastDateKey;
        showHeading = false;
        title = null;
      } else if (dateKey) {
        lastDateKey = dateKey;
      }

      const dateRank = generateKeyBetween(datePrevRank, null);
      datePrevRank = dateRank;

      const [dateEntry] = await db
        .insert(entries)
        .values({
          type: "game_date",
          title,
          parentId: sessionEntry.id,
          dateKey,
          sortRank: dateRank,
          showHeading,
        })
        .returning({ id: entries.id });

      const joinedText = item.text.join("\n\n").trim();
      const voiceBlocks = parseVoiceBlocks(joinedText);
      if (voiceBlocks.length > 0) {
        const blockRanks = rankSequence(voiceBlocks.length);
        await db.insert(blocks).values(
          voiceBlocks.map((b, idx) => ({
            entryId: dateEntry.id,
            writerId: b.writerSlug === "nemah" ? nemahId : lucyId,
            body: b.body,
            sortRank: blockRanks[idx],
          })),
        );
      }
    }
  }

  console.log("Seed complete.");
  console.log(`Writers: ${WRITER_DEFS.length}, Characters: ${CHARACTER_DATA.length}`);
  console.log(`Default PIN: ${defaultPin}`);
}

seed()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
