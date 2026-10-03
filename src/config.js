// Tunables for Hollowtide. Times are in seconds, distances in metres.
export const VERSION = '0.2.0';

// One tide cycle (about 5 minutes). The ruins are only reachable on foot during LOW.
export const TIDE = {
  day: 120,     // high tide (craft, stash, prepare)
  ebb: 20,      // the water drains
  low: 150,     // the Hollow: the seabed is open
  flood: 25,    // the water rushes back
  high: 0.0,    // water height at high tide
  lowLevel: -19 // water height at low tide (the deepest trenches keep water as tide pools)
};
export const CYCLE = TIDE.day + TIDE.ebb + TIDE.low + TIDE.flood;

// The lagoon is about 1.4 km across: a big home island, three outpost islands, 28 ruin sites,
// all ringed by an atoll that keeps the sea out of the Hollow.
export const WORLD = {
  size: 1500,         // terrain square side
  segments: 500,      // 3 m between terrain samples
  rim: 690,           // where the atoll ring starts
  sites: 38,
  islands: [
    { x: 0, z: 0, r: 82, h: 17, name: 'Home Isle', main: true },
    { x: 330, z: -260, r: 46, h: 11, name: 'Gull Rock' },
    { x: -400, z: -180, r: 52, h: 12, name: 'Lantern Key' },
    { x: 60, z: 470, r: 50, h: 11, name: 'Driftwood Cay' }
  ]
};

export const PLAYER = {
  walk: 5.4, sprint: 9.2, swim: 3.6, swimSprint: 5.8,
  accel: 38, airAccel: 9, friction: 9, waterAccel: 7,
  jump: 7.6, gravity: 23, coyote: 0.12, jumpBuffer: 0.14,
  health: 100, oxygen: 30, stamina: 100,
  attackRange: 2.3, attackDamage: 25, attackCooldown: 0.5,
  eye: 1.62
};

// Things you can find, and what upgrades cost
export const ITEMS = {
  shell: { name: 'Shell', color: '#f3d9c8', icon: '🐚' },
  pearl: { name: 'Pearl', color: '#e8f1ff', icon: '⚪' },
  coin: { name: 'Relic Coin', color: '#ffcf5c', icon: '🪙' },
  gear: { name: 'Ancient Gear', color: '#9fd6c9', icon: '⚙️' },
  idol: { name: 'Drowned Idol', color: '#c79bff', icon: '🗿' }
};

export const UPGRADES = [
  { id: 'lantern', name: 'Tide Lantern', icon: '🏮', desc: 'Lights the Hollow around you at night.', cost: { shell: 6, pearl: 2 }, max: 1 },
  { id: 'lungs', name: 'Deep Lungs', icon: '🫁', desc: '+15 seconds of air per level.', cost: { pearl: 4, coin: 2 }, max: 3 },
  { id: 'fins', name: 'Kelp Fins', icon: '🦈', desc: 'Swim 25% faster per level.', cost: { shell: 10, coin: 3 }, max: 2 },
  { id: 'pack', name: 'Salvage Pack', icon: '🎒', desc: 'Carry 10 more items per level.', cost: { shell: 8, gear: 1 }, max: 3 },
  { id: 'blade', name: 'Coral Blade', icon: '🗡️', desc: '+15 damage against crabs.', cost: { coin: 4, gear: 2 }, max: 2 },
  { id: 'boots', name: 'Strider Boots', icon: '🥾', desc: 'Run 12% faster on land per level.', cost: { shell: 12, gear: 1 }, max: 2 },
  { id: 'charm', name: 'Tide Charm', icon: '🧿', desc: 'Warns you 15 seconds earlier when the flood is coming.', cost: { idol: 1 }, max: 1 }
];

export const PACK_BASE = 15;
