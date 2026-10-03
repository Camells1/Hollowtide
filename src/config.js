// Tunables for Hollowtide. Times are in seconds, distances in metres.
export const VERSION = '0.1.0';

// One tide cycle (about 5 minutes). The ruins are only reachable on foot during LOW.
export const TIDE = {
  day: 120,     // high tide on the island (craft, stash, prepare)
  ebb: 20,      // the water drains
  low: 120,     // the Hollow: the seabed is open
  flood: 25,    // the water rushes back
  high: 0.0,    // water height at high tide
  lowLevel: -19 // water height at low tide (only the deepest trenches keep water)
};
export const CYCLE = TIDE.day + TIDE.ebb + TIDE.low + TIDE.flood;

export const WORLD = {
  size: 520,          // terrain square side
  segments: 240,
  islandRadius: 48,   // shoreline at high tide
  rimStart: 222,      // the atoll ring that encloses the lagoon
  sites: 7            // ruin sites on the seabed
};

export const PLAYER = {
  walk: 5.2, sprint: 8.4, swim: 3.4, swimSprint: 5.2,
  jump: 7.5, gravity: 22,
  health: 100, oxygen: 30, stamina: 100,
  reach: 2.4, attackRange: 2.1, attackDamage: 25, attackCooldown: 0.55
};

// Things you can find, and what upgrades cost
export const ITEMS = {
  shell: { name: 'Shell', color: '#f3d9c8', value: 1 },
  pearl: { name: 'Pearl', color: '#e8f1ff', value: 4 },
  coin: { name: 'Relic Coin', color: '#ffcf5c', value: 6 },
  gear: { name: 'Ancient Gear', color: '#9fd6c9', value: 10 },
  idol: { name: 'Drowned Idol', color: '#c79bff', value: 25 }
};

export const UPGRADES = [
  { id: 'lantern', name: 'Tide Lantern', desc: 'Lights the Hollow around you at night.', cost: { shell: 6, pearl: 2 }, max: 1 },
  { id: 'lungs', name: 'Deep Lungs', desc: '+15 seconds of air per level.', cost: { pearl: 4, coin: 2 }, max: 3 },
  { id: 'fins', name: 'Kelp Fins', desc: 'Swim 25% faster per level.', cost: { shell: 10, coin: 3 }, max: 2 },
  { id: 'pack', name: 'Salvage Pack', desc: 'Carry 10 more items per level.', cost: { shell: 8, gear: 1 }, max: 3 },
  { id: 'blade', name: 'Coral Blade', desc: '+15 damage against crabs.', cost: { coin: 4, gear: 2 }, max: 2 },
  { id: 'charm', name: 'Tide Charm', desc: 'Warns you 15 seconds earlier when the flood is coming.', cost: { idol: 1 }, max: 1 }
];

export const PACK_BASE = 15;
