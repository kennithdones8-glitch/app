// Reference content for the development model: skills, failure reasons, constraints,
// opponent archetypes, decision scenarios and combination patterns.

export const SKILLS = {
  footwork: { name: 'Footwork', group: 'Movement' },
  distance: { name: 'Distance management', group: 'Movement' },
  angles: { name: 'Angles', group: 'Movement' },
  ringCutting: { name: 'Ring cutting', group: 'Movement' },
  headMovement: { name: 'Head movement', group: 'Defense' },
  defense: { name: 'Defense', group: 'Defense' },
  clinch: { name: 'Clinch', group: 'Defense' },
  jab: { name: 'Jab', group: 'Offense' },
  cross: { name: 'Cross', group: 'Offense' },
  hooks: { name: 'Hooks', group: 'Offense' },
  uppercuts: { name: 'Uppercuts', group: 'Offense' },
  combinations: { name: 'Combinations', group: 'Offense' },
  counters: { name: 'Counters', group: 'Ring IQ' },
  feints: { name: 'Feints', group: 'Ring IQ' },
  timing: { name: 'Timing', group: 'Ring IQ' },
  rhythm: { name: 'Rhythm', group: 'Ring IQ' },
  fightIQ: { name: 'Fight IQ', group: 'Ring IQ' },
  conditioning: { name: 'Conditioning', group: 'Engine' },
};

export const SKILL_GROUPS = ['Offense', 'Defense', 'Movement', 'Ring IQ', 'Engine'];

// "Why did you get hit?" — each reason points at skills and a constraint that attacks it.
export const HIT_REASONS = {
  failedExit: { name: 'Failed exit (straight back)', skills: ['angles', 'footwork', 'defense'], constraint: 'exitEvery' },
  handsDown: { name: 'Hands down', skills: ['defense'], constraint: 'guardRecovery' },
  distance: { name: 'Poor distance', skills: ['distance', 'footwork'], constraint: 'inOut' },
  rhythm: { name: 'Predictable rhythm', skills: ['rhythm', 'feints'], constraint: 'rhythmBreak' },
  overextended: { name: 'Overextended', skills: ['distance', 'defense'], constraint: 'inOut' },
  missedCounter: { name: "Didn't see the counter", skills: ['timing', 'fightIQ', 'defense'], constraint: 'counterOnly' },
  headPosition: { name: 'Head on centre line', skills: ['headMovement'], constraint: 'headMove' },
  footworkError: { name: 'Footwork error', skills: ['footwork'], constraint: 'jabFootwork' },
  fatigue: { name: 'Fatigue', skills: ['conditioning'], constraint: 'fatigueSim' },
  tactical: { name: 'Tactical mistake', skills: ['fightIQ'], constraint: 'counterOnly' },
};

// Things that went right in sparring — positive evidence.
export const POSITIVES = {
  jabLanded: { name: 'Jab landing', skills: ['jab', 'distance'] },
  counterLanded: { name: 'Counters landing', skills: ['counters', 'timing'] },
  cleanExits: { name: 'Clean exits', skills: ['angles', 'footwork'] },
  cutRing: { name: 'Cut the ring', skills: ['ringCutting'] },
  bodyWork: { name: 'Body work landed', skills: ['hooks', 'uppercuts', 'combinations'] },
  feintsWorked: { name: 'Feints worked', skills: ['feints', 'rhythm'] },
  clinchControl: { name: 'Clinch control', skills: ['clinch'] },
  slipped: { name: 'Slipped / rolled well', skills: ['headMovement', 'defense'] },
  lastedPace: { name: 'Held pace late', skills: ['conditioning'] },
};

// Constraint rounds: give the boxer a problem to solve, not just a task.
// `auto(metrics)` scores compliance from camera data when that's possible.
export const CONSTRAINTS = {
  jabFootwork: {
    name: 'Jab + footwork only', text: 'Only the jab. Move after every one: in, out, left, right.',
    skills: ['jab', 'footwork', 'distance'], combos: ['1', '1, 1', '1, step out', '1, pivot'],
    auto: (m) => (m.totalPunches >= 5 ? Math.round((m.punches.jab / m.totalPunches) * 100) : null),
  },
  exitEvery: {
    name: 'Every combo ends with an exit', text: 'Every combination must finish with a pivot, pull, guard recovery or angle exit. Never straight back.',
    skills: ['angles', 'footwork', 'defense'], combos: ['1, 2, pivot', '1, 2, 3, angle out', '2, 3, 2, pull', '1, 1, 2, step left'],
    auto: (m) => (m.footwork != null ? Math.min(100, Math.round(m.footwork * 1.6)) : null),
  },
  counterOnly: {
    name: 'Counterpunching only', text: 'Never lead. Picture his jab — slip, parry or pull, then fire back.',
    skills: ['counters', 'timing', 'fightIQ'], combos: ['slip, 2', 'parry, 1, 2', 'pull, 2', 'roll, 3, 2', 'catch, 1, 2'],
  },
  bodyHead: {
    name: 'Body–head combinations', text: 'Change levels: every combination goes to the body and back up (or head then body).',
    skills: ['hooks', 'uppercuts', 'combinations'], combos: ['1, 2 body, 3', '2 body, 3 head', '3 body, 3 head', '1, 2, 3 body, 2'],
  },
  pressureDefense: {
    name: 'Under pressure', text: 'He walks you down all round. No straight-back steps — pivot, angle, or tie up.',
    skills: ['defense', 'angles', 'clinch'], combos: ['pivot, 1, 2', 'angle left, 2, 3', 'tie up', 'roll, 3, pivot'],
  },
  fatigueSim: {
    name: 'Fatigue simulation', text: 'Every 30 seconds: 10 seconds all-out straight punches, then back to clean technique immediately.',
    skills: ['conditioning', 'defense'], burst: true, combos: ['1, 2', '1, 2, 3, 2'],
  },
  feints: {
    name: 'Feint before you attack', text: 'Every attack starts with a feint: shoulder, hand, foot or level change.',
    skills: ['feints', 'rhythm', 'timing'], combos: ['feint 1, 2', 'feint body, 1', 'shoulder feint, 3', 'foot feint, 1, 2'],
  },
  ringCut: {
    name: 'Cut the ring', text: "He's moving away. Step to cut off his exits, don't follow him. Trap, then punch.",
    skills: ['ringCutting', 'footwork', 'distance'], combos: ['cut left, 1, 2', 'cut right, 2, 3', 'trap, 1, 2, 3'],
  },
  clinchWork: {
    name: 'Clinch entries & exits', text: 'After close combos, tie up, turn him, and break out on an angle.',
    skills: ['clinch', 'angles'], combos: ['3, 2, tie up, turn', '5, 3, clinch, exit left'],
  },
  rhythmBreak: {
    name: 'Break your rhythm', text: 'Vary speed and timing: half-beat punches, pauses, doubled-up shots. Be unpredictable.',
    skills: ['rhythm', 'feints', 'timing'], combos: ['1, pause, 1, 2', '1-1 fast, 2', '2, pause, 3', 'feint, pause, 2'],
  },
  headMove: {
    name: 'Move your head after every combo', text: 'Punch, then slip or roll. Every single time.',
    skills: ['headMovement', 'defense'], combos: ['1, 2, slip', '1, 2, 3, roll', '2, 3, slip, 2'],
    auto: (m) => (m.head != null ? Math.min(100, Math.round(m.head * 1.6)) : null),
  },
  guardRecovery: {
    name: 'Guard recovery', text: 'Hands back to the face after every punch before you move. Freeze-check your guard on every combo.',
    skills: ['defense'], combos: ['1, hands home', '1, 2, hands home', '3, 2, reset'],
    auto: (m) => m.guard,
  },
  inOut: {
    name: 'In and out', text: 'Attack from the edge of range and be gone before he can answer. Never stay in the pocket.',
    skills: ['distance', 'footwork', 'timing'], combos: ['step in 1, 2, out', 'long 1, back', '1, 2, step out'],
    auto: (m) => (m.footwork != null ? Math.min(100, Math.round(m.footwork * 1.6)) : null),
  },
  southpawWork: {
    name: 'Versus a southpaw', text: 'Lead foot outside his, rear hand straight down the middle, circle to your left.',
    skills: ['angles', 'cross', 'fightIQ'], combos: ['step outside, 2', '1, 2, circle left', '2, 3, step outside'],
  },
};

// Opponent archetypes for shadowboxing rounds.
export const OPPONENTS = {
  pressure: { name: 'Pressure fighter', prompts: ["He's walking you down", 'Pivot off the ropes', 'Punch as he steps in', 'Angle out'], constraint: 'pressureDefense' },
  counter: { name: 'Counterpuncher', prompts: ['Feint to draw the counter', "Don't reach", 'Double the jab', 'Counter his counter'], constraint: 'feints' },
  outfighter: { name: 'Long outfighter', prompts: ["He's on his bike — cut him off", 'Jab to the body to close distance', 'Trap him'], constraint: 'ringCut' },
  southpaw: { name: 'Southpaw', prompts: ['Lead foot outside', 'Straight right down the middle', 'Circle left'], constraint: 'southpawWork' },
  swarmer: { name: 'Aggressive swarmer', prompts: ['Jab and move', 'Tie him up', 'Uppercut as he ducks in', 'Pivot out'], constraint: 'clinchWork' },
  bodyPuncher: { name: 'Heavy body puncher', prompts: ['Elbows tight', 'Step back and counter', "Don't stand in front of him"], constraint: 'inOut' },
  volume: { name: 'High-volume fighter', prompts: ['Block and fire back', 'Make him pay', 'Short counters', 'Break his rhythm'], constraint: 'counterOnly' },
  clincher: { name: 'Clinch-heavy fighter', prompts: ['Punch your way out', 'Frame and turn', 'Uppercut on the way in'], constraint: 'clinchWork' },
};

// Decision drills. `best` is the conventional coaching answer; `ok` are defensible alternatives.
export const SCENARIOS = [
  { id: 'ropes-pressure', text: "He's pressing forward and your back is near the ropes.", options: ['Pivot left and angle off', 'Check hook as he comes in', 'Clinch', 'Step straight back'], best: [0], ok: [1, 2], tags: ['angles', 'defense', 'ringCutting'], why: 'Straight back keeps you on his line and trapped. Pivoting takes his angle away; a check hook or clinch works if he rushes.' },
  { id: 'corner-trapped', text: "You're trapped in a corner and he's loading up.", options: ['Cover up and wait', 'Tie him up then turn him', 'Throw a wild hook', 'Slip, then pivot out'], best: [3], ok: [1], tags: ['defense', 'clinch', 'angles'], why: 'Waiting invites a beating. Slip-and-pivot or a clinch-and-turn gets you out.' },
  { id: 'jab-lazy', text: "His jab comes back low and slow after he throws it.", options: ['Counter over it with a right hand', 'Jab with him', 'Step back', 'Throw a body hook'], best: [0], ok: [], tags: ['counters', 'timing', 'cross'], why: 'A lazy, low returning jab is an open door for an overhand or straight right over the top.' },
  { id: 'southpaw-foot', text: 'Versus a southpaw, your lead feet are lined up.', options: ['Get your lead foot outside his', 'Circle to your right', 'Lead with a jab to the chest', 'Swap stance'], best: [0], ok: [], tags: ['angles', 'fightIQ'], why: 'Outside foot position opens the straight right and takes away his left.' },
  { id: 'southpaw-circle', text: 'A southpaw keeps landing his straight left.', options: ['Circle to your right', 'Circle to your left, away from his power hand', 'Stand and trade', 'Raise your left hand only'], best: [1], ok: [], tags: ['footwork', 'defense', 'fightIQ'], why: 'Circle away from the power hand (to your left, toward his right side).' },
  { id: 'counter-waiting', text: "He's a counterpuncher: waits, and makes you miss.", options: ['Throw more single power shots', 'Feint to draw his counter, then counter that', 'Stop punching', 'Rush him'], best: [1], ok: [], tags: ['feints', 'timing', 'counters'], why: 'Feints make a counterpuncher commit so you can counter his counter.' },
  { id: 'runner', text: 'He keeps moving away and you are chasing and missing.', options: ['Follow him step for step', 'Cut the ring: step to where he is going', 'Wait in the centre', 'Throw long hooks'], best: [1], ok: [], tags: ['ringCutting', 'footwork'], why: "Chasing loses. Cutting off his exit angle traps him; don't follow." },
  { id: 'tired-late', text: 'Round 5: you are exhausted and he is still coming.', options: ['Trade to end it', 'Jab, tie up, and use the ring to recover', 'Drop your hands to rest', 'Stand still and block'], best: [1], ok: [], tags: ['conditioning', 'clinch', 'fightIQ'], why: 'Recover with smart work: jab, clinch, move. Never drop the guard.' },
  { id: 'hurt-him', text: 'You just stunned him with a right hand.', options: ['Swing wildly for the knockout', 'Stay composed: tight straight shots, cut off his escape', 'Step back and admire it', 'Clinch'], best: [1], ok: [], tags: ['fightIQ', 'combinations', 'ringCutting'], why: 'Composed, accurate follow-ups finish fights; wild swings get you countered.' },
  { id: 'body-open', text: 'He holds his guard high and tight whenever you jab.', options: ['Jab harder at the gloves', 'Go to the body, then come back up', 'Only throw uppercuts', 'Stop attacking'], best: [1], ok: [], tags: ['combinations', 'hooks', 'fightIQ'], why: 'A high shell leaves the body open; body work brings the hands down for head shots.' },
  { id: 'overhand-coming', text: 'He loads up an overhand right every time you jab.', options: ['Stop jabbing', 'Jab and slip right/roll under immediately', 'Jab and step straight back', 'Throw a left hook as he loads up'], best: [1], ok: [3], tags: ['headMovement', 'timing', 'counters'], why: 'Move your head off the line after the jab, or beat him to it with a short hook.' },
  { id: 'range-long', text: 'He has a longer reach and is picking you off with the jab.', options: ['Stay at the end of his jab', 'Parry the jab and step in behind it', 'Jab back from long range', 'Back away'], best: [1], ok: [], tags: ['distance', 'defense', 'counters'], why: 'Beat the taller man by closing distance behind a parry or slip, not by trading at his range.' },
  { id: 'range-short', text: "You're taller, and he keeps getting inside to work.", options: ['Fight inside with him', 'Jab, move, and pivot off as he closes', 'Hold constantly', 'Lean back'], best: [1], ok: [2], tags: ['distance', 'footwork', 'jab'], why: 'Keep him at the end of your jab and turn him as he comes in.' },
  { id: 'clinch-inside', text: 'He clinches you and leans his weight on you.', options: ['Relax and wait for the ref', 'Frame, turn him, and punch as you break', 'Push him straight back', 'Throw punches while he holds your arms'], best: [1], ok: [], tags: ['clinch', 'angles'], why: 'Frame and turn to win position, then punch on the break.' },
  { id: 'rhythm-read', text: 'He has started timing you: you jab, he counters every time.', options: ['Jab faster', 'Change rhythm: feint, half-beat, double jab', 'Stop jabbing entirely', 'Throw the same jab harder'], best: [1], ok: [], tags: ['rhythm', 'feints', 'fightIQ'], why: 'Being read means you are predictable. Change rhythm to break his timing.' },
  { id: 'after-combo', text: 'You just threw a 4-punch combination in the pocket.', options: ['Stand and look at him', 'Exit on an angle or roll out', 'Step straight back', 'Drop your hands and reset'], best: [1], ok: [], tags: ['angles', 'defense', 'footwork'], why: 'The moment after a combination is when you get countered. Leave on an angle.' },
  { id: 'lead-hook-coming', text: 'He throws a lead hook every time you throw the cross.', options: ['Stop throwing the cross', 'Keep your left hand high and roll under, then 3-2', 'Lean back', 'Throw the cross harder'], best: [1], ok: [], tags: ['defense', 'counters', 'headMovement'], why: 'Protect with the lead glove up, roll the hook, answer with your own hook-cross.' },
  { id: 'scoring-close', text: 'Last round, you think it is close on the cards.', options: ['Coast and stay safe', 'Win the round clearly: busy, clean, and visible', 'Go all out with wild shots', 'Hold for most of it'], best: [1], ok: [], tags: ['fightIQ', 'conditioning'], why: 'Close fights are won with visible, clean work in the last round.' },
  { id: 'body-shot-hurt', text: 'He just hurt you with a body shot.', options: ['Bend over and cover', 'Clinch or move, breathe, keep your elbows tight', 'Throw back wildly', 'Turn your back'], best: [1], ok: [], tags: ['defense', 'clinch', 'conditioning'], why: 'Buy time safely: tie up or move, elbows tight, recover your breathing.' },
  { id: 'feint-bait', text: 'He keeps feinting and you keep flinching.', options: ['Flinch less and counter his real attack', 'Jab through his feints to take the initiative', 'Back up every time', 'Close your eyes'], best: [1], ok: [0], tags: ['timing', 'jab', 'fightIQ'], why: 'Take the initiative: a sharp jab disrupts a feinter; stop reacting to everything.' },
];

// Common combination patterns to track through training → sparring.
export const PATTERN_LIBRARY = [
  { name: 'Jab → cross → angle exit', seq: '1-2', exit: 'angle', skills: ['combinations', 'angles'] },
  { name: 'Double jab → cross', seq: '1-1-2', skills: ['jab', 'combinations'] },
  { name: 'Jab → cross → lead hook', seq: '1-2-3', skills: ['combinations', 'hooks'] },
  { name: 'Cross → hook → cross', seq: '2-3-2', skills: ['combinations', 'hooks'] },
  { name: 'Slip → cross counter', seq: '2', exit: null, counter: true, skills: ['counters', 'headMovement'] },
  { name: 'Pull → cross counter', seq: '2', counter: true, skills: ['counters', 'timing'] },
  { name: 'Lead hook body → hook head', seq: '3-3', skills: ['hooks', 'combinations'] },
  { name: 'Jab → rear uppercut → hook → cross', seq: '1-6-3-2', skills: ['combinations', 'uppercuts'] },
];

// Tags that can be attached to coach/self observations.
export const OBS_TAGS = {
  ...Object.fromEntries(Object.entries(SKILLS).map(([k, v]) => [k, v.name])),
  ...Object.fromEntries(Object.entries(HIT_REASONS).map(([k, v]) => [`hit:${k}`, v.name])),
};
