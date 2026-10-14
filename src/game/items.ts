export type StatMods = {
  hp?: number;
  mana?: number;
  ad?: number;
  ap?: number;
  armor?: number;
  mr?: number;
  as?: number; // Angriffstempo in Prozent
  ms?: number; // Lauftempo in Prozent
  crit?: number; // Krit-Chance in Prozent
  ls?: number; // Lebensraub in Prozent
  haste?: number; // Fähigkeitstempo
  hpReg?: number;
  manaReg?: number;
};

export type ItemDef = {
  id: string;
  name: string;
  cost: number;
  icon: string;
  stats: StatMods;
  desc: string;
  boots?: boolean;
  tier: 1 | 2 | 3;
};

export const ITEMS: ItemDef[] = [
  { id: "boots", name: "Stiefel", cost: 300, icon: "👢", tier: 1, boots: true, stats: { ms: 10 }, desc: "+10% Lauftempo" },
  { id: "swiftboots", name: "Flinke Stiefel", cost: 900, icon: "🥾", tier: 2, boots: true, stats: { ms: 18, as: 15 }, desc: "+18% Lauftempo, +15% Angriffstempo" },
  { id: "longsword", name: "Langschwert", cost: 350, icon: "🗡️", tier: 1, stats: { ad: 12 }, desc: "+12 Angriffsschaden" },
  { id: "tome", name: "Verstärkungsfolio", cost: 400, icon: "📘", tier: 1, stats: { ap: 22 }, desc: "+22 Fähigkeitsstärke" },
  { id: "ruby", name: "Rubinkristall", cost: 400, icon: "❤️", tier: 1, stats: { hp: 160 }, desc: "+160 Leben" },
  { id: "dagger", name: "Dolch", cost: 300, icon: "🔪", tier: 1, stats: { as: 14 }, desc: "+14% Angriffstempo" },
  { id: "cloth", name: "Kettenhemd", cost: 450, icon: "🛡️", tier: 1, stats: { armor: 25 }, desc: "+25 Rüstung" },
  { id: "cloak", name: "Negatronmantel", cost: 450, icon: "🧥", tier: 1, stats: { mr: 28 }, desc: "+28 Magieresistenz" },
  { id: "bloodthirster", name: "Blutdürster", cost: 3000, icon: "🩸", tier: 3, stats: { ad: 55, ls: 18 }, desc: "+55 Schaden, +18% Lebensraub" },
  { id: "infinity", name: "Unendlichkeitsklinge", cost: 3300, icon: "⚔️", tier: 3, stats: { ad: 65, crit: 25 }, desc: "+65 Schaden, +25% Krit" },
  { id: "stormblade", name: "Sturmklinge", cost: 2700, icon: "⚡", tier: 3, stats: { as: 40, crit: 25, ms: 7 }, desc: "+40% Angriffstempo, +25% Krit" },
  { id: "cleaver", name: "Schwarzes Beil", cost: 3000, icon: "🪓", tier: 3, stats: { ad: 40, hp: 350, haste: 20 }, desc: "+40 Schaden, +350 Leben, +20 Fähigkeitstempo" },
  { id: "deathcap", name: "Todeshaube", cost: 3400, icon: "🎩", tier: 3, stats: { ap: 115 }, desc: "+115 Fähigkeitsstärke" },
  { id: "timestaff", name: "Zeitenstab", cost: 2800, icon: "🔮", tier: 3, stats: { ap: 70, hp: 300, haste: 20 }, desc: "+70 FS, +300 Leben, +20 Fähigkeitstempo" },
  { id: "voidstaff", name: "Leerenstab", cost: 2800, icon: "🌌", tier: 3, stats: { ap: 75, mana: 300, manaReg: 2 }, desc: "+75 FS, +300 Mana" },
  { id: "sunfire", name: "Sonnenfeuer-Umhang", cost: 2700, icon: "☀️", tier: 3, stats: { hp: 450, armor: 40 }, desc: "+450 Leben, +40 Rüstung" },
  { id: "spiritcloak", name: "Geistesmantel", cost: 2700, icon: "👻", tier: 3, stats: { hp: 400, mr: 55, hpReg: 3 }, desc: "+400 Leben, +55 MR" },
  { id: "thornmail", name: "Dornenpanzer", cost: 2600, icon: "🌵", tier: 3, stats: { hp: 300, armor: 60 }, desc: "+300 Leben, +60 Rüstung" },
  { id: "warmog", name: "Herz des Riesen", cost: 2900, icon: "💚", tier: 3, stats: { hp: 800, hpReg: 6 }, desc: "+800 Leben, starke Regeneration" },
];

export const ITEM_BY_ID: Record<string, ItemDef> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
