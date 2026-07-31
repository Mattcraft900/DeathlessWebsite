/**
 * One-shot generator for scripts/data/travelogue-stress.json
 * Run: npx tsx scripts/generate-travelogue-stress.ts
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const titles = [
    "The Road to Last Chance",
    "Mist on the Marsh",
    "Whispers in the Reeds",
    "Wagon Wheel Blues",
    "The Crooked Ferry",
    "Thunder Without Rain",
    "Lanterns Over the Causeway",
    "A Bargain of Birds",
    "The Soft-Tooth Boar",
    "Night Watch Arguments",
    "Salt on the Tongue",
    "The Hollow Bell",
    "Footprints That Sink",
    "Market Day Mirage",
    "Ember Between Stones",
    "The Cartwright's Oath",
    "Green Water Rising",
    "A Stranger Shares Pop",
    "Storm Behind the Trees",
    "Almost Shen Ora",
];

const irl = [
    "7.25.26",
    "8.01.26",
    "8.08.26",
    "8.15.26",
    "8.22.26",
    "8.29.26",
    "9.05.26",
    "9.12.26",
    "9.19.26",
    "9.26.26",
    "10.03.26",
    "10.10.26",
    "10.17.26",
    "10.24.26",
    "10.31.26",
    "11.07.26",
    "11.14.26",
    "11.21.26",
    "11.28.26",
    "12.05.26",
];

/** Headed-date counts (sum 27 ≈ 1.35/session). leadNull = continue prior game-date. */
const plans = [
    { headed: 0, leadNull: true },
    { headed: 1, leadNull: false },
    { headed: 2, leadNull: false },
    { headed: 1, leadNull: true },
    { headed: 0, leadNull: true },
    { headed: 3, leadNull: false },
    { headed: 1, leadNull: false },
    { headed: 1, leadNull: false },
    { headed: 5, leadNull: false },
    { headed: 0, leadNull: true },
    { headed: 2, leadNull: false },
    { headed: 1, leadNull: false },
    { headed: 1, leadNull: true },
    { headed: 4, leadNull: false },
    { headed: 0, leadNull: true },
    { headed: 2, leadNull: false },
    { headed: 1, leadNull: false },
    { headed: 1, leadNull: false },
    { headed: 1, leadNull: false },
    { headed: 0, leadNull: true },
];

const paras = [
    "The road turned soft under the wheels and Warrior huffed like he had opinions about mud. I wrote this sitting in the cart with a bottle of that angry juice Nemah calls pop, watching the reeds lean all one way in the wind.",
    "Nobody said much for a stretch of miles. Luark kept his eyes on the treeline. Enza hummed something wet and half-remembered. Chesco narrated Warrior's every mood until Nemah asked him—politely, for Nemah—to please stop.",
    "I keep practicing letters even when my hand goes stiff. The pages still look crooked, but they're mine. If anyone reads this later, hello from the middle of a swamp that smells like hot tea left too long.",
    "We made camp early because the ground finally stayed firm enough for stakes. The kindred sat with his back to a stump and half-watched the dark. I volunteered first watch again. Nightmares are quieter if I stay busy.",
    "Around noon we passed a crooked marker stone that nobody could agree on the carving of. Chesco swore it was a warning about spiders. Enza said it was a blessing for travelers. I copied the shape into the margin anyway.",
    "Dinner was travel rations and something Enza pulled from a damp pouch that tasted like peppered riverweed. Not bad. Nemah ate carefully, joints clicking when she stood. I asked if she was alright. She said yes in the short way.",
    "A ferry man tried to charge us three times the usual crossing fee, saw Luark's rifle, and suddenly remembered a discount for polite customers. Chesco tipped him with a joke. The ferry man did not laugh, but we crossed.",
    "I dreamed of Mama Yaga's house walking on chicken legs through the marsh, then woke up to Warrior snoring and thought maybe that was better. Then I wrote until my charcoal nub got short.",
    "We argued once about the route—west and wet versus south and prickly. Last Chance won again. Shen Ora can wait another week if the wetlands stay kind. Beckstead is still a word that makes Chesco go quiet.",
    "Rain came sideways for an hour and stopped as if someone closed a door. The cart cover held. My journal did not. I am rewriting this paragraph from memory and probably inventing half of it, which Nemah will scold me for later.",
];

function gameDateLabel(n: number): string {
    let m = 7;
    let d = 23 + n;
    let y = 568;
    const dim = (month: number) =>
        [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month]!;
    while (d > dim(m)) {
        d -= dim(m);
        m++;
        if (m > 12) {
            m = 1;
            y++;
        }
    }
    return `${m} / ${d} / ${y}`;
}

function pageParas(seed: number, count: number): string[] {
    const out: string[] = [];
    for (let i = 0; i < count; i++) out.push(paras[(seed + i) % paras.length]!);
    return out;
}

let dayOffset = 0;
const sessions = [];

for (let i = 0; i < 20; i++) {
    const plan = plans[i]!;
    const chunks: { game_date: string | null; text: string[] }[] = [];
    const totalParas = 4 + (i % 4); // 4–7 ≈ 1–2 pages
    const actualChunks = Math.max(1, (plan.leadNull ? 1 : 0) + plan.headed);
    const per = Math.max(1, Math.floor(totalParas / actualChunks));
    let leftover = totalParas - per * actualChunks;

    if (plan.leadNull) {
        const n = per + (leftover > 0 ? 1 : 0);
        if (leftover > 0) leftover--;
        chunks.push({ game_date: null, text: pageParas(i * 3, n) });
    }

    for (let h = 0; h < plan.headed; h++) {
        if (i % 3 === 0 && h === 0) dayOffset++;
        const label = gameDateLabel(dayOffset++);
        const n = per + (leftover > 0 ? 1 : 0);
        if (leftover > 0) leftover--;
        chunks.push({
            game_date: label,
            text: pageParas(i * 7 + h * 2, Math.max(n, 1)),
        });
    }

    if (chunks.length === 0) {
        chunks.push({ game_date: null, text: pageParas(i, totalParas) });
    }

    sessions.push({
        session_date: `[TEST] ${irl[i]} - "${titles[i]}"`,
        content: chunks,
    });
}

const headed = sessions.reduce(
    (a, s) => a + s.content.filter((c) => c.game_date).length,
    0,
);
const outPath = resolve(__dirname, "data/travelogue-stress.json");
writeFileSync(outPath, `${JSON.stringify(sessions, null, 2)}\n`);
console.log(
    `Wrote ${sessions.length} sessions, ${headed} headed dates (avg ${(headed / sessions.length).toFixed(2)}) → ${outPath}`,
);
