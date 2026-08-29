// Which AI change hurt? Run gametest's core loop under config toggles.
const L = '../src/modes/autochess/';
const { Combat, CombatUnit, setCombatRng, ROUND_TIME, playerDamage } = await import(L + 'combat.ts');
const { UNIT_BY_ID } = await import(L + 'units.ts');
const { Pool, Roster, Economy, SHOP_SIZE, REROLL_COST, XP_COST, XP_PER_ROUND, boardCapacity } = await import(L + 'shop.ts');
const AImod = await import(L + 'ai.ts');
const { AiOpponent, AI_TUNING } = AImod;
const Hex = await import(L + 'hex.ts');
const STEP = 1/60;
const seeded = s0 => { let s = s0|0; return () => { s=(s+0x6D2B79F5)|0; let t=Math.imul(s^(s>>>15),1|s); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; };
const FRONT=[[3,6],[2,6],[4,6],[1,6],[5,6],[0,6],[6,6]], BACK=[[3,7],[2,7],[4,7],[1,7],[5,7],[0,7],[6,7]];

function playerTurn(roster, econ, pool, r) {
  econ.grantXp(XP_PER_ROUND);
  const target = r<=2?3:r<=5?4:r<=8?5:r<=11?6:r<=15?7:r<=20?8:9;
  const reserve = r<=3?0:r<=8?10:20;
  while (econ.level < target && econ.gold - XP_COST >= reserve) if (!econ.buyXp()) break;
  let shop = pool.roll(econ.level, SHOP_SIZE);
  for (let pass=0; pass<3; pass++) {
    let bought=false;
    const ranked = shop.map((id,i)=>id?{id,i}:null).filter(Boolean).map(c=>{
      const o=roster.entries.filter(e=>e.unitId===c.id);
      const ones=o.filter(e=>e.star===1).length, twos=o.filter(e=>e.star===2).length, threes=o.filter(e=>e.star===3).length;
      const copies=ones+3*twos+9*threes;
      let score;
      if (threes>0||copies>=9) score=-1;
      else if (ones===2&&twos===2) score=1200; else if (ones>=2) score=900;
      else if (twos>=1) score=700; else if (ones>=1) score=600;
      else if (roster.entries.length<boardCapacity(econ.level)) score=300;
      else score=120+UNIT_BY_ID[c.id].cost*45;
      return {...c,score};
    }).sort((a,b)=>b.score-a.score);
    for (const c of ranked) {
      if (c.score<0) continue;
      const cost=UNIT_BY_ID[c.id].cost;
      if (econ.gold<cost) continue;
      const flush=econ.gold>=reserve+20;
      if (c.score<900&&!flush&&econ.gold-cost<reserve) continue;
      if (roster.benchFull()) break;
      if (!pool.take(c.id)) continue;
      econ.spend(cost); roster.add(c.id); shop[c.i]=null; bought=true;
    }
    if (!bought && econ.gold-REROLL_COST-reserve>=14) { econ.spend(REROLL_COST); shop=pool.roll(econ.level,SHOP_SIZE); continue; }
    if (!bought) break;
  }
  for (const e of roster.entries) e.cell=null;
  const cap=boardCapacity(econ.level);
  const rank=e=>e.star*1000+UNIT_BY_ID[e.unitId].cost*10;
  const chosen=[...roster.entries].sort((a,b)=>rank(b)-rank(a)).slice(0,cap);
  const front=[...FRONT], back=[...BACK];
  for (const e of chosen) {
    const p=UNIT_BY_ID[e.unitId].range>1?(back.length?back:front):(front.length?front:back);
    const s=p.shift(); if(!s) break; e.cell=Hex.cellId(s[0],s[1]);
  }
  return chosen.filter(e=>e.cell!==null);
}

function game(seed, cfg) {
  setCombatRng(seeded(seed));
  const pool=new Pool(); const roster=new Roster(pool); const econ=new Economy();
  econ.level=2; econ.gold=3;
  const ai=new AiOpponent(pool);
  if (cfg.noHygiene) ai._benchHygiene = () => {};
  let hp=100, aiHp=100, r=1;
  for (; r<=30 && hp>0 && aiHp>0; r++) {
    ai.econ.hp = aiHp;                      // let stabilise-mode see reality
    const aiSpecs = ai.takeTurn(r);
    const placed = playerTurn(roster, econ, pool, r);
    if (!placed.length) break;
    const pU=placed.map(e=>new CombatUnit(UNIT_BY_ID[e.unitId],e.star,'player',Hex.idCol(e.cell),Hex.idRow(e.cell)));
    const eU=aiSpecs.map(s2=>new CombatUnit(UNIT_BY_ID[s2.id],s2.star,'enemy',s2.col,s2.row));
    const c=new Combat([...pU,...eU]);
    let g=Math.ceil((ROUND_TIME+5)/STEP); while(!c.over&&g-->0) c.update(STEP);
    const stage=Math.min(8,1+Math.ceil(r/5));
    const won=c.winner==='player';
    if(!won) hp=Math.max(0,hp-playerDamage(stage,c.living('enemy')));
    if(c.winner!=='enemy') aiHp=Math.max(0,aiHp-playerDamage(stage,c.living('player')));
    econ.recordResult(won); econ.payout(); ai.settle(!won);
  }
  return aiHp<=0&&hp>0;
}

const CONFIGS = [
  ['current everything        ', {}],
  ['no bench hygiene          ', { noHygiene: true }],
  ['old tempo/reserve/rolls   ', { oldEcon: true }],
  ['old econ + no hygiene     ', { oldEcon: true, noHygiene: true }],
];
const OLD = {
  levelTempo: r => (r<=2?3:r<=5?4:r<=8?5:r<=11?6:r<=15?7:r<=20?8:9),
  reserve: r => (r<=3?0:r<=8?10:20),
  maxRolls: r => (r<=3?0:r<=8?2:4),
  rollThreshold: 8,
};
const NEW = { ...AI_TUNING };
for (const [name, cfg] of CONFIGS) {
  Object.assign(AI_TUNING, cfg.oldEcon ? OLD : NEW);
  const rand = seeded(777);
  let wins = 0; const N = 150;
  for (let i = 0; i < N; i++) if (game((rand()*2**31)|0, cfg)) wins++;
  console.log(`${name} player wins ${(100*wins/N).toFixed(0)}%`);
}
Object.assign(AI_TUNING, NEW);
