import { healthStandards } from './storage.js';

export const slotKey = (day, meal) => `${day}|${meal}`;
export const dayIndexes = plan => Array.from({ length: Number(plan.days) }, (_, i) => i);
export const getSlot = (plan, day, meal) => plan.slots[slotKey(day, meal)] || [];
let indexedDishSource = null;
let indexedDishes = new Map();
let candidateSource = null;
let candidateIndex = new Map();
function ensureDishIndexes(state) {
  if (indexedDishSource !== state.dishes) {
    indexedDishSource = state.dishes;
    indexedDishes = new Map(state.dishes.map(dish => [dish.id, dish]));
  }
  if (candidateSource !== state.dishes) {
    candidateSource = state.dishes;
    candidateIndex = new Map();
    state.dishes.forEach(dish => {
      (dish.meals || []).forEach(meal => {
        for (const category of ['', dish.category]) {
          const key = `${meal}|${category}`;
          if (!candidateIndex.has(key)) candidateIndex.set(key, []);
          candidateIndex.get(key).push(dish);
        }
      });
    });
  }
}
export const dishOf = (state, item) => {
  ensureDishIndexes(state);
  return indexedDishes.get(item?.dishId);
};
export const currentPlan = state => state.plans.find(p => p.id === state.currentPlanId) || state.plans[0];
export const isNoodleStaple = dish =>
  dish?.category === '主食' && String(dish.name || '').trim().endsWith('面');
export const isMainOnlyStaple = dish => dish?.category === '主食' && Boolean(dish.mainOnly);
const dishCuisines = dish => Array.isArray(dish?.cuisine)
  ? dish.cuisine
  : (dish?.cuisine ? [dish.cuisine] : []);
export const isSeafood = dish => {
  const searchable = `${dish?.name || ''} ${(dish?.ingredients || []).join(' ')}`;
  return dish?.tags?.includes('海鲜') || /海鲜|鱼|虾|蟹|贝|蛤|蚝|鱿|章鱼|鲍/.test(searchable);
};

export const menuPreferenceOptions = {
  health: ['均衡营养', '低脂', '少油少盐', '高蛋白'],
  audience: ['普通', '儿童友好', '老人友好'],
  scene: ['日常', '聚餐', '宴请']
};
export function normalizePreferences(preferences = {}) {
  const legacyHealth = {
    均衡: '均衡营养',
    清淡: '少油少盐',
    低糖: '低脂',
    高蛋白: '高蛋白'
  };
  return {
    health: menuPreferenceOptions.health.includes(preferences.health)
      ? preferences.health
      : (legacyHealth[preferences.health] || '均衡营养'),
    audience: menuPreferenceOptions.audience.includes(preferences.audience)
      ? preferences.audience : '普通',
    scene: menuPreferenceOptions.scene.includes(preferences.scene)
      ? preferences.scene : '日常'
  };
}

const CATEGORY_ORDER = ['肉菜', '蔬菜', '主食', '甜品', '汤饮', '其他'];
function bucketOf(dish) {
  if (!dish) return '';
  if (dish.category === '肉菜') return 'meat';
  if (dish.category === '蔬菜') return 'vegetable';
  if (dish.category === '主食') return 'staple';
  if (dish.category === '甜品') return 'dessert';
  if (dish.category === '汤饮' || dish.category === '其他') return 'other';
  return '';
}

export function getMealTarget(plan, meal, preferences = {}) {
  const people = Math.max(1, Number(plan.people) || 1);
  const pref = normalizePreferences({ health: preferences.health || plan.goal });
  const ratioKey = pref.health === '高蛋白'
    ? '高蛋白'
    : pref.health === '低脂' || pref.health === '少油少盐'
      ? '清淡'
      : '均衡';
  const ratios = healthStandards[ratioKey] || healthStandards['均衡'];
  const mainCount = meal === '早餐'
    ? (people < 4 ? people : 5)
    : (people <= 3 ? people : people <= 6 ? people + 1 : people + 2);
  const staple = 1;
  const sideCount = meal === '早餐' ? Math.max(0, mainCount - staple) : mainCount;
  const meatVegetableTotal = Number(ratios.meat || 0) + Number(ratios.vegetable || 0) || 1;
  const calculatedMeat = sideCount
    ? Math.max(0, Math.min(sideCount, Math.round(sideCount * Number(ratios.meat || 0) / meatVegetableTotal)))
    : 0;
  const meat = meal === '早餐' ? Math.min(1, calculatedMeat) : calculatedMeat;
  const vegetable = sideCount - meat;
  const dessert = meal === '早餐' || people <= 6 ? 0 : 1;
  const other = meal === '早餐' || people <= 3 ? 0 : 1;
  return {
    people,
    meat,
    vegetable,
    staple,
    dessert,
    other,
    total: sideCount + staple + dessert + other,
    mainCount
  };
}

export function eligible(state, plan, meal, excluded = new Set(), category = '', options = {}) {
  const dislikes = String(plan.dislike || '').split(/[，、\s]+/).filter(Boolean);
  const cuisines = Array.isArray(plan.cuisines) ? plan.cuisines : [];
  const maxSpicy = Math.max(0, Math.min(5, Number(plan.maxSpicy ?? 5)));
  ensureDishIndexes(state);
  const base = candidateIndex.get(`${meal}|${category}`) || [];
  const matches = base.filter(d => options.manual || (
    (!cuisines.length || dishCuisines(d).some(value => cuisines.includes(value))) &&
    Number(d.spicyLevel || 0) <= maxSpicy &&
    !dislikes.some(word =>
      String(d.name || '').includes(word) ||
      (Array.isArray(d.ingredients) && d.ingredients.some(i => String(i).includes(word)))
    )
  ));
  const fresh = matches.filter(d => !excluded.has(d.id));
  return fresh.length ? fresh : matches;
}

function historyContext(state, plan) {
  const recentPlans = (state.plans || [])
    .filter(item => item.id !== plan.id && Object.values(item.slots || {}).some(items => items?.length))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, 6);
  const usage = new Map();
  recentPlans.forEach((item, index) => {
    const weight = Math.max(1, 6 - index);
    Object.values(item.slots || {}).flat().forEach(entry => {
      if (entry?.dishId) usage.set(entry.dishId, (usage.get(entry.dishId) || 0) + weight);
    });
  });
  let previousDayHadNoodle = false;
  const latest = recentPlans[0];
  if (latest) {
    const lastDay = Math.max(0, Number(latest.days || 1) - 1);
    previousDayHadNoodle = (latest.meals || []).some(meal =>
      (latest.slots?.[slotKey(lastDay, meal)] || [])
        .some(item => isNoodleStaple(dishOf(state, item)))
    );
  }
  return { usage, previousDayHadNoodle };
}

function preferenceAdjustment(dish, preferences) {
  const pref = normalizePreferences(preferences);
  const tags = new Set(dish.healthTags || []);
  const text = `${dish.name || ''} ${(dish.ingredients || []).join(' ')}`;
  const fried = /炸|油煎|酥|油焖/.test(text);
  const sugary = /糖|蜜|奶油|蛋糕|布丁|甜/.test(text);
  const stimulating = /麻辣|香辣|辣椒|腌|咸|重口/.test(text);
  let value = 0;
  if (pref.health === '低脂') value += tags.has('低油') ? 8 : 0, value -= fried ? 9 : 0;
  if (pref.health === '少油少盐') {
    value += tags.has('低油') ? 6 : 0;
    value += tags.has('低盐') ? 7 : 0;
    value += tags.has('清淡') ? 5 : 0;
    value -= fried || stimulating ? 8 : 0;
  }
  if (pref.health === '高蛋白') value += tags.has('高蛋白') ? 8 : 0;
  if (pref.audience === '老人友好') {
    value += tags.has('低油') || tags.has('低盐') || tags.has('清淡') ? 7 : 0;
    value += isSeafood(dish) ? 7 : 0;
    value += dish.category === '蔬菜' || dish.category === '汤饮' ? 5 : 0;
    value += tags.has('高蛋白') ? 3 : 0;
    value -= fried || sugary || stimulating || Number(dish.spicyLevel || 0) > 1 ? 10 : 0;
  }
  if (pref.audience === '儿童友好') {
    value += tags.has('高蛋白') ? 6 : 0;
    value += dish.category === '蔬菜' ? 4 : 0;
    value += dishCuisines(dish).includes('中餐') ? 2 : 0;
    value -= stimulating || Number(dish.spicyLevel || 0) > 1 ? 12 : 0;
  }
  if (pref.scene === '日常' && dishCuisines(dish).includes('中餐')) value += 1.5;
  if (pref.scene !== '日常' && dish.favorite) value += 2;
  return value;
}

function score(dish, plan, mealDishes, historyUsage, preferences, adjustment = 0) {
  let value = Math.random() * 4 + (dish.favorite ? 5 : 0);
  value += preferenceAdjustment(dish, preferences);
  if (mealDishes.some(d => d.category === dish.category)) value -= 4;
  value -= (historyUsage.get(dish.id) || 0) * 2.5;
  return value + adjustment;
}

function strictCandidates(state, plan, meal, category = '', preferences = {}) {
  const pref = normalizePreferences(preferences);
  return eligible(state, plan, meal, new Set(), category)
    .filter(d => d.category !== '超大菜')
    .filter(d => pref.audience === '普通' || Number(d.spicyLevel || 0) <= 1);
}

function pickCandidate(
  state,
  plan,
  meal,
  used,
  mealDishes,
  dayUsed,
  category,
  remainingBudget,
  remainingSlots,
  historyUsage,
  preferences,
  { allowNoodle = true, allowMainOnly = true, previousDayHadNoodle = false } = {}
) {
  const mealIds = new Set(mealDishes.map(d => d.id));
  let candidates = strictCandidates(state, plan, meal, category, preferences)
    .filter(d => !mealIds.has(d.id))
    .filter(d => !dayUsed.has(d.id))
    .filter(d => allowNoodle || !isNoodleStaple(d))
    .filter(d => allowMainOnly || !isMainOnlyStaple(d));
  if (!candidates.length) return null;
  const globallyFresh = candidates.filter(d => !used.has(d.id));
  if (globallyFresh.length) candidates = globallyFresh;
  const adjustedScore = dish => score(
    dish,
    plan,
    mealDishes,
    historyUsage,
    preferences,
    previousDayHadNoodle && isNoodleStaple(dish) ? -18 : 0
  );
  if (!Number(plan.budget)) return [...candidates].sort((a, b) => adjustedScore(b) - adjustedScore(a))[0];
  const allowance = Math.max(0, remainingBudget) / Math.max(1, remainingSlots);
  const affordable = candidates.filter(d => Number(d.price || 0) <= allowance * 1.15);
  const pool = affordable.length ? affordable : candidates;
  return [...pool].sort((a, b) =>
    affordable.length
      ? adjustedScore(b) - adjustedScore(a)
      : Number(a.price || 0) - Number(b.price || 0)
  )[0];
}

function countsFor(state, items) {
  const counts = { meat: 0, vegetable: 0, staple: 0, dessert: 0, other: 0 };
  items.forEach(item => {
    const bucket = bucketOf(dishOf(state, item));
    if (bucket) counts[bucket] += 1;
  });
  return counts;
}

function isFriedOrHeavy(dish) {
  const text = `${dish?.name || ''} ${(dish?.ingredients || []).join(' ')}`;
  return /炸|油煎|酥|油焖|麻辣|香辣|重口/.test(text);
}

export function analyzeMenu(state, plan, preferences = {}, slots = plan.slots || {}) {
  const pref = normalizePreferences(preferences);
  const meals = [];
  const warnings = [];
  const blockers = [];
  let totalDishes = 0;
  let meat = 0;
  let vegetables = 0;
  let seafood = 0;
  let soup = 0;
  let friedOrHeavy = 0;

  for (const day of dayIndexes(plan)) {
    for (const meal of plan.meals) {
      const key = slotKey(day, meal);
      const items = (slots[key] || []).filter(item => item?.dishId);
      const dishes = items.map(item => dishOf(state, item)).filter(Boolean);
      const target = getMealTarget(plan, meal, pref);
      const counts = countsFor(state, items);
      const mainOnlyCount = dishes.filter(isMainOnlyStaple).length;
      const gaps = {
        meat: Math.max(0, target.meat - counts.meat),
        vegetable: Math.max(0, target.vegetable - counts.vegetable),
        staple: Math.max(0, target.staple - counts.staple),
        dessert: Math.max(0, target.dessert - counts.dessert),
        other: Math.max(0, target.other - (target.dessert === 0 ? counts.other + counts.dessert : counts.other)),
        soup: 0
      };
      if (counts.meat + counts.vegetable >= target.meat + target.vegetable) {
        gaps.meat = 0;
        gaps.vegetable = 0;
      }
      if (mainOnlyCount) Object.keys(gaps).forEach(key => { gaps[key] = 0; });
      const hasSoup = dishes.some(dish => dish.category === '汤饮');
      if (meal !== '早餐' && !mainOnlyCount && !hasSoup && target.other > 0 && gaps.other === 0) gaps.soup = 1;
      const needed = Object.values(gaps).reduce((sum, value) => sum + value, 0);
      const capacity = Math.max(0, target.total - items.length);
      const mealWarnings = [];
      if (items.length && counts.vegetable === 0 && !mainOnlyCount) mealWarnings.push('缺少蔬菜');
      if (meal !== '早餐' && items.length && !hasSoup && !mainOnlyCount) {
        mealWarnings.push('缺少汤饮');
      }
      if (items.length && counts.staple === 0 && !mainOnlyCount) mealWarnings.push('缺少主食');
      if (dishes.length && dishes.filter(isFriedOrHeavy).length / dishes.length >= 0.5) mealWarnings.push('油炸或重口味比例偏高');
      meals.push({ day, meal, key, current: items.length, target, counts, gaps, capacity, warnings: mealWarnings });

      totalDishes += dishes.length;
      meat += counts.meat;
      vegetables += counts.vegetable;
      seafood += dishes.filter(isSeafood).length;
      soup += dishes.filter(dish => dish.category === '汤饮').length;
      friedOrHeavy += dishes.filter(isFriedOrHeavy).length;
    }
  }
  if (totalDishes && meat / totalDishes > 0.6) warnings.push('当前菜单肉类比例明显偏高');
  if (totalDishes && vegetables === 0) warnings.push('当前菜单没有蔬菜');
  if (totalDishes && friedOrHeavy / totalDishes >= 0.5) warnings.push('当前菜单油炸或重口味菜品比例明显偏高');
  if (totalDishes && soup === 0 && plan.meals.some(meal => meal !== '早餐')) warnings.push('当前菜单没有汤饮');
  if (pref.audience === '老人友好' && totalDishes && seafood === 0) warnings.push('老人友好菜单建议补充鱼类或海鲜');
  return {
    preferences: pref,
    meals,
    warnings: [...new Set(warnings)],
    blockers: [...new Set(blockers)],
    totals: { dishes: totalDishes, meat, vegetables, seafood, soup, friedOrHeavy },
    missing: meals.reduce((sum, item) =>
      sum + Object.values(item.gaps).reduce((value, gap) => value + gap, 0), 0)
  };
}

export function completeExistingMenu(state, plan, preferences = {}) {
  const pref = normalizePreferences(preferences);
  const before = analyzeMenu(state, plan, pref);
  if (before.blockers.length) {
    throw new Error(`当前菜单需要先整理：${before.blockers[0]}。已有菜品不会被自动删除。`);
  }
  const previousGoal = plan.goal;
  const goalMap = {
    均衡营养: '均衡',
    低脂: '清淡',
    少油少盐: '清淡',
    高蛋白: '高蛋白'
  };
  plan.goal = goalMap[pref.health] || previousGoal || '均衡';
  try {
    const completed = generateCompletePlan(state, plan, {
      seedSlots: structuredClone(plan.slots || {}),
      preferences: pref
    });
    return { slots: completed, before, after: analyzeMenu(state, plan, pref, completed) };
  } catch (error) {
    plan.goal = previousGoal;
    throw error;
  }
}

export function distributeSelected(state, plan, selectedIds) {
  const slots = structuredClone(plan.slots || {});
  const targets = dayIndexes(plan).flatMap(day =>
    plan.meals.map(meal => ({ day, meal, key: slotKey(day, meal), target: getMealTarget(plan, meal) }))
  );

  for (const dishId of selectedIds) {
    const dish = dishOf(state, { dishId });
    if (!dish) throw new Error('已选菜品不存在，请刷新菜品库后重试。');
    const candidates = targets
      .sort((a, b) => {
        const aItems = slots[a.key] || [];
        const bItems = slots[b.key] || [];
        const bucket = bucketOf(dish);
        const aDeficit = bucket ? (a.target[bucket] || 0) - (countsFor(state, aItems)[bucket] || 0) : 0;
        const bDeficit = bucket ? (b.target[bucket] || 0) - (countsFor(state, bItems)[bucket] || 0) : 0;
        return bDeficit - aDeficit || aItems.length - bItems.length || a.day - b.day;
      });
    const destination = candidates[0];
    if (!destination) throw new Error('当前菜单没有可安排的餐次。');
    slots[destination.key] = [...(slots[destination.key] || []), {
      dishId,
      quantity: dish.category === '主食' ? Number(plan.people) : 1,
      servings: Number(plan.people),
      locked: false
    }];
  }
  return slots;
}

export function buildSelectedPlan(state, plan, selectedIds, autoFill = false) {
  const selectedSlots = distributeSelected(state, plan, selectedIds);
  if (!autoFill) return selectedSlots;
  return generateCompletePlan(state, plan, { seedSlots: selectedSlots });
}

export function generateCompletePlan(state, plan, options = {}) {
  const slots = {};
  const used = new Set();
  const people = Math.max(1, Number(plan.people) || 1);
  const preferences = normalizePreferences(options.preferences || { health: plan.goal });
  const history = historyContext(state, plan);
  const seedSlots = structuredClone(options.seedSlots || {});
  const totalPlannedSlots = dayIndexes(plan).reduce((total, day) =>
    total + plan.meals.reduce((sum, meal) => sum + getMealTarget(plan, meal, preferences).total, 0), 0
  );
  let remainingBudget = Number(plan.budget) || Infinity;
  let remainingSlots = totalPlannedSlots;
  let estimatedCost = 0;
  let previousDayHadNoodle = history.previousDayHadNoodle;
  const generatedCounts = { meat: 0, vegetable: 0, staple: 0, dessert: 0, other: 0 };

  const fail = (meal, detail) => {
    throw new Error(`${meal}无法生成完整菜单：${detail}。请补充符合人数、餐次、菜系和辣度条件的菜品后重试。`);
  };
  const sortItems = items => items.sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(dishOf(state, a)?.category);
    const bi = CATEGORY_ORDER.indexOf(dishOf(state, b)?.category);
    return (ai < 0 ? CATEGORY_ORDER.length : ai) - (bi < 0 ? CATEGORY_ORDER.length : bi);
  });

  for (const day of dayIndexes(plan)) {
    const reservedForDay = new Set(
      plan.meals.flatMap(meal => (seedSlots[slotKey(day, meal)] || []).map(item => item.dishId))
    );
    const dayUsed = new Set(reservedForDay);
    let dayHasNoodle = false;
    for (const meal of plan.meals) {
      const key = slotKey(day, meal);
      const target = getMealTarget(plan, meal, preferences);
      const items = [...(seedSlots[key] || [])];
      const mealDishes = [];

      for (const item of items) {
        const dish = dishOf(state, item);
        if (!dish) fail(meal, '已有菜单中存在已删除的菜品');
        item.quantity = dish.category === '主食' ? people : Number(item.quantity || 1);
        item.servings = people;
        used.add(dish.id);
        mealDishes.push(dish);
        if (isNoodleStaple(dish)) dayHasNoodle = true;
        estimatedCost += Number(dish.price || 0) * Number(item.quantity || 1);
        if (Number.isFinite(remainingBudget)) remainingBudget -= Number(dish.price || 0) * Number(item.quantity || 1);
        remainingSlots = Math.max(0, remainingSlots - 1);
      }

      const seededMainOnly = mealDishes.filter(isMainOnlyStaple);
      if (seededMainOnly.length) {
        if (seededMainOnly.some(isNoodleStaple)) dayHasNoodle = true;
        slots[key] = items;
        continue;
      }

      const add = (category, quantity = 1, pickOptions = {}) => {
        const selected = pickCandidate(
          state, plan, meal, used, mealDishes, dayUsed, category,
          remainingBudget, remainingSlots, history.usage, preferences, pickOptions
        );
        if (!selected) return null;
        const item = { dishId: selected.id, quantity, servings: people, locked: false };
        items.push(item);
        mealDishes.push(selected);
        used.add(selected.id);
        dayUsed.add(selected.id);
        generatedCounts[bucketOf(selected)] += 1;
        const cost = Number(selected.price || 0) * quantity;
        estimatedCost += cost;
        if (Number.isFinite(remainingBudget)) remainingBudget -= cost;
        remainingSlots = Math.max(0, remainingSlots - 1);
        return item;
      };

      let counts = countsFor(state, items);
      if (counts.staple < target.staple) {
        const staple = add('主食', people, {
          allowNoodle: !dayHasNoodle,
          allowMainOnly: items.length === 0,
          previousDayHadNoodle
        });
        if (!staple) fail(meal, '没有可用主食');
        if (isMainOnlyStaple(dishOf(state, staple))) {
          if (isNoodleStaple(dishOf(state, staple))) dayHasNoodle = true;
          slots[key] = [staple];
          continue;
        }
      }

      counts = countsFor(state, items);
      const sideTarget = target.meat + target.vegetable;
      if (counts.meat + counts.vegetable < sideTarget) {
        while (counts.meat < target.meat && counts.meat + counts.vegetable < sideTarget) {
          if (!add('肉菜')) fail(meal, `肉菜候选不足，目标 ${target.meat} 道`);
          counts = countsFor(state, items);
        }
        while (counts.vegetable < target.vegetable && counts.meat + counts.vegetable < sideTarget) {
          if (!add('蔬菜')) fail(meal, `蔬菜候选不足，目标 ${target.vegetable} 道`);
          counts = countsFor(state, items);
        }
      }
      while (counts.dessert < target.dessert) {
        if (!add('甜品')) fail(meal, '没有可用甜品');
        counts = countsFor(state, items);
      }
      const flexibleOtherCount = () => target.dessert === 0
        ? counts.other + counts.dessert
        : counts.other;
      if (meal !== '早餐' && target.other > 0 && !mealDishes.some(dish => dish.category === '汤饮')) {
        if (!add('汤饮')) fail(meal, '没有可用汤饮');
        counts = countsFor(state, items);
      }
      while (flexibleOtherCount() < target.other) {
        const order = preferences.health === '少油少盐' ||
          preferences.health === '低脂' ||
          preferences.audience === '老人友好'
          ? ['汤饮', '其他', '甜品']
          : ['汤饮', '甜品', '其他'];
        let added = null;
        for (const category of order) {
          added = add(category);
          if (added) break;
        }
        if (!added) fail(meal, '没有可用的甜品、汤饮或其他菜品');
        counts = countsFor(state, items);
      }

      counts = countsFor(state, items);
      if (counts.meat + counts.vegetable < sideTarget ||
          counts.staple < target.staple ||
          counts.dessert < target.dessert ||
          flexibleOtherCount() < target.other) {
        fail(meal, '最终数量或分类校验失败');
      }
      slots[key] = sortItems(items);
    }
    previousDayHadNoodle = dayHasNoodle;
  }

  const ratios = healthStandards[plan.goal] || healthStandards['均衡'];
  plan.generationProfile = {
    standard: plan.goal,
    ratios: { ...ratios },
    people,
    mealTemplate: {
      dishCount: people <= 3 ? people : people <= 6 ? people + 1 : people + 2,
      stapleCount: 1,
      stapleQuantity: people,
      dessertCount: people > 6 ? 1 : 0,
      otherCount: people > 3 ? 1 : 0
    },
    breakfastTemplate: {
      stapleQuantity: people,
      dishCount: people < 4 ? people : 5,
      dishLimit: 5,
      meatLimit: 1
    },
    generatedCounts,
    totalSlots: Object.values(slots).flat().length,
    budget: Number(plan.budget) || 0,
    estimatedCost
  };
  return slots;
}

export function replaceDish(state, plan, day, meal, index) {
  const current = getSlot(plan, day, meal)[index];
  const currentDish = dishOf(state, current);
  if (!currentDish) return false;
  const used = new Set(Object.values(plan.slots).flat().filter(i => i.dishId).map(i => i.dishId));
  const targetMeal = meal === '自选' ? '晚餐' : meal;
  const standardCategories = ['肉菜', '蔬菜', '主食', '甜品', '超大菜'];
  const sameCategory = dish => {
    if (standardCategories.includes(currentDish.category)) return dish.category === currentDish.category;
    return !standardCategories.includes(dish.category);
  };
  const candidates = eligible(state, plan, targetMeal, new Set())
    .filter(d => d.id !== currentDish.id && d.category !== '超大菜' && sameCategory(d));
  const fresh = candidates.filter(d => !used.has(d.id));
  const pool = fresh.length ? fresh : candidates;
  const replacement = pool[Math.floor(Math.random() * pool.length)];
  if (!replacement) return false;
  plan.slots[slotKey(day, meal)][index] = { ...current, dishId: replacement.id };
  return true;
}

export function shoppingSummary(state, plan) {
  const map = new Map();
  Object.values(plan.slots).flat().filter(item => item.dishId).forEach(item => {
    const d = dishOf(state, item);
    if (!d) return;
    const existing = map.get(d.id) || { id: d.id, name: d.name, image: d.image, ingredients:[...(d.ingredients||[])], quantity: 0 };
    existing.quantity += Number(item.quantity || 1);
    map.set(d.id, existing);
  });
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}
