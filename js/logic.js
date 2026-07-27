import { healthStandards } from './storage.js';

export const slotKey = (day, meal) => `${day}|${meal}`;
export const dayIndexes = plan => Array.from({ length: Number(plan.days) }, (_, i) => i);
export const getSlot = (plan, day, meal) => plan.slots[slotKey(day, meal)] || [];
export const dishOf = (state, item) => state.dishes.find(d => d.id === item.dishId);
export const currentPlan = state => state.plans.find(p => p.id === state.currentPlanId) || state.plans[0];
export const isNoodleStaple = dish =>
  dish?.category === '主食' && String(dish.name || '').trim().endsWith('面');

const CATEGORY_ORDER = ['肉菜', '蔬菜', '主食', '甜品', '汤饮', '其他'];
const OTHER_CATEGORIES = new Set(['甜品', '汤饮', '其他']);

function bucketOf(dish) {
  if (!dish) return '';
  if (dish.category === '肉菜') return 'meat';
  if (dish.category === '蔬菜') return 'vegetable';
  if (dish.category === '主食') return 'staple';
  if (OTHER_CATEGORIES.has(dish.category)) return 'other';
  return '';
}

export function getMealTarget(plan, meal) {
  const people = Math.max(1, Number(plan.people) || 1);
  const ratios = healthStandards[plan.goal] || healthStandards['均衡'];
  const sideCount = meal === '早餐'
    ? Math.min(Math.max(people - 1, 0), 4)
    : (people <= 2 ? 2 : people + 1);
  const meatVegetableTotal = Number(ratios.meat || 0) + Number(ratios.vegetable || 0) || 1;
  const meat = sideCount
    ? Math.max(0, Math.min(sideCount, Math.round(sideCount * Number(ratios.meat || 0) / meatVegetableTotal)))
    : 0;
  const vegetable = sideCount - meat;
  const other = meal === '早餐' ? 0 : 1;
  return {
    people,
    meat,
    vegetable,
    staple: 1,
    other,
    total: sideCount + 1 + other
  };
}

export function eligible(state, plan, meal, excluded = new Set(), category = '') {
  const dislikes = String(plan.dislike || '').split(/[，、\s]+/).filter(Boolean);
  const cuisines = Array.isArray(plan.cuisines) ? plan.cuisines : [];
  const maxSpicy = Math.max(0, Math.min(5, Number(plan.maxSpicy ?? 5)));
  const matches = state.dishes.filter(d =>
    (!category || d.category === category) &&
    Array.isArray(d.meals) && d.meals.includes(meal) &&
    Array.isArray(d.servingOptions) && d.servingOptions.map(Number).includes(Number(plan.people)) &&
    (!cuisines.length || cuisines.includes(d.cuisine)) &&
    Number(d.spicyLevel || 0) <= maxSpicy &&
    !dislikes.some(word =>
      String(d.name || '').includes(word) ||
      (Array.isArray(d.ingredients) && d.ingredients.some(i => String(i).includes(word)))
    )
  );
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

function score(dish, plan, mealDishes, historyUsage, adjustment = 0) {
  let value = Math.random() * 4 + (dish.favorite ? 5 : 0);
  if (plan.goal === '清淡' && (dish.healthTags?.includes('清淡') || dish.healthTags?.includes('低油'))) value += 7;
  if (plan.goal === '高蛋白' && dish.healthTags?.includes('高蛋白')) value += 7;
  if (plan.goal === '低糖' && dish.healthTags?.includes('低糖')) value += 7;
  if (mealDishes.some(d => d.category === dish.category)) value -= 4;
  value -= (historyUsage.get(dish.id) || 0) * 2.5;
  return value + adjustment;
}

function strictCandidates(state, plan, meal, category = '') {
  return eligible(state, plan, meal, new Set(), category)
    .filter(d => d.category !== '超大菜');
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
  { allowNoodle = true, previousDayHadNoodle = false } = {}
) {
  const mealIds = new Set(mealDishes.map(d => d.id));
  let candidates = strictCandidates(state, plan, meal, category)
    .filter(d => !mealIds.has(d.id))
    .filter(d => !dayUsed.has(d.id))
    .filter(d => allowNoodle || !isNoodleStaple(d));
  if (!candidates.length) return null;
  const globallyFresh = candidates.filter(d => !used.has(d.id));
  if (globallyFresh.length) candidates = globallyFresh;
  const adjustedScore = dish => score(
    dish,
    plan,
    mealDishes,
    historyUsage,
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
  const counts = { meat: 0, vegetable: 0, staple: 0, other: 0 };
  items.forEach(item => {
    const bucket = bucketOf(dishOf(state, item));
    if (bucket) counts[bucket] += 1;
  });
  return counts;
}

function validateDishForPlan(state, plan, dish, meal) {
  return dish &&
    dish.category !== '超大菜' &&
    strictCandidates(state, plan, meal, dish.category).some(item => item.id === dish.id);
}

export function distributeSelected(state, plan, selectedIds) {
  const slots = {};
  const targets = dayIndexes(plan).flatMap(day =>
    plan.meals.map(meal => ({ day, meal, key: slotKey(day, meal), target: getMealTarget(plan, meal) }))
  );
  const selectedDayUses = new Map();

  for (const dishId of selectedIds) {
    const dish = state.dishes.find(item => item.id === dishId);
    if (!dish) throw new Error('已选菜品不存在，请刷新菜品库后重试。');
    const priorDays = selectedDayUses.get(dishId) || new Set();
    const candidates = targets
      .filter(item => validateDishForPlan(state, plan, dish, item.meal))
      .filter(item => !priorDays.has(item.day))
      .filter(item => {
        const existing = slots[item.key] || [];
        const hasNoodle = existing.some(entry => isNoodleStaple(dishOf(state, entry)));
        if (isNoodleStaple(dish)) {
          const dayHasNoodle = targets
            .filter(target => target.day === item.day)
            .some(target => (slots[target.key] || []).some(entry => isNoodleStaple(dishOf(state, entry))));
          return existing.length === 0 && !dayHasNoodle;
        }
        if (hasNoodle) return false;
        const bucket = bucketOf(dish);
        const counts = countsFor(state, existing);
        return bucket && counts[bucket] < item.target[bucket] && existing.length < item.target.total;
      })
      .sort((a, b) => {
        const aItems = slots[a.key] || [];
        const bItems = slots[b.key] || [];
        const bucket = bucketOf(dish);
        const aDeficit = a.target[bucket] - countsFor(state, aItems)[bucket];
        const bDeficit = b.target[bucket] - countsFor(state, bItems)[bucket];
        return bDeficit - aDeficit || aItems.length - bItems.length || a.day - b.day;
      });
    const destination = candidates[0];
    if (!destination) {
      throw new Error(`已选菜品“${dish.name}”无法在不重复且不超出餐次规则的前提下安排，请减少该类菜品或增加菜单天数。`);
    }
    slots[destination.key] = [...(slots[destination.key] || []), {
      dishId,
      quantity: dish.category === '主食' ? Number(plan.people) : 1,
      servings: Number(plan.people),
      locked: false
    }];
    priorDays.add(destination.day);
    selectedDayUses.set(dishId, priorDays);
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
  const history = historyContext(state, plan);
  const seedSlots = structuredClone(options.seedSlots || {});
  const totalPlannedSlots = dayIndexes(plan).reduce((total, day) =>
    total + plan.meals.reduce((sum, meal) => sum + getMealTarget(plan, meal).total, 0), 0
  );
  let remainingBudget = Number(plan.budget) || Infinity;
  let remainingSlots = totalPlannedSlots;
  let estimatedCost = 0;
  let previousDayHadNoodle = history.previousDayHadNoodle;
  const generatedCounts = { meat: 0, vegetable: 0, staple: 0, other: 0 };

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
    const seenSeedIds = new Set();
    let dayHasNoodle = false;
    for (const meal of plan.meals) {
      const key = slotKey(day, meal);
      const target = getMealTarget(plan, meal);
      const items = [...(seedSlots[key] || [])];
      const mealDishes = [];

      for (const item of items) {
        const dish = dishOf(state, item);
        if (!validateDishForPlan(state, plan, dish, meal)) fail(meal, `已选菜品“${dish?.name || '未知菜品'}”不符合当前筛选条件`);
        if (seenSeedIds.has(dish.id)) fail(meal, `同一天重复选择了“${dish.name}”`);
        item.quantity = dish.category === '主食' ? people : Number(item.quantity || 1);
        item.servings = people;
        seenSeedIds.add(dish.id);
        used.add(dish.id);
        mealDishes.push(dish);
        estimatedCost += Number(dish.price || 0) * Number(item.quantity || 1);
        if (Number.isFinite(remainingBudget)) remainingBudget -= Number(dish.price || 0) * Number(item.quantity || 1);
        remainingSlots = Math.max(0, remainingSlots - 1);
      }

      const seededNoodles = mealDishes.filter(isNoodleStaple);
      if (seededNoodles.length) {
        if (seededNoodles.length > 1 || items.length > 1 || dayHasNoodle) fail(meal, '面类主食必须单独成餐，且同一天最多出现一次');
        dayHasNoodle = true;
        slots[key] = items;
        continue;
      }

      const initialCounts = countsFor(state, items);
      for (const bucket of ['meat', 'vegetable', 'staple', 'other']) {
        if (initialCounts[bucket] > target[bucket]) fail(meal, `已选${bucket === 'meat' ? '肉菜' : bucket === 'vegetable' ? '蔬菜' : bucket === 'staple' ? '主食' : '甜品/汤饮/其他'}数量超过餐次上限`);
      }

      const add = (category, quantity = 1, pickOptions = {}) => {
        const selected = pickCandidate(
          state, plan, meal, used, mealDishes, dayUsed, category,
          remainingBudget, remainingSlots, history.usage, pickOptions
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
          allowNoodle: items.length === 0 && !dayHasNoodle,
          previousDayHadNoodle
        });
        if (!staple) fail(meal, '没有可用主食');
        if (isNoodleStaple(dishOf(state, staple))) {
          dayHasNoodle = true;
          slots[key] = [staple];
          continue;
        }
      }

      counts = countsFor(state, items);
      while (counts.meat < target.meat) {
        if (!add('肉菜')) fail(meal, `肉菜候选不足，目标 ${target.meat} 道`);
        counts = countsFor(state, items);
      }
      while (counts.vegetable < target.vegetable) {
        if (!add('蔬菜')) fail(meal, `蔬菜候选不足，目标 ${target.vegetable} 道`);
        counts = countsFor(state, items);
      }
      while (counts.other < target.other) {
        const order = plan.goal === '清淡' || plan.goal === '低糖'
          ? ['汤饮', '其他', '甜品']
          : ['甜品', '汤饮', '其他'];
        let added = null;
        for (const category of order) {
          added = add(category);
          if (added) break;
        }
        if (!added) fail(meal, '没有可用的甜品、汤饮或其他菜品');
        counts = countsFor(state, items);
      }

      counts = countsFor(state, items);
      if (items.length !== target.total ||
          counts.meat !== target.meat ||
          counts.vegetable !== target.vegetable ||
          counts.staple !== target.staple ||
          counts.other !== target.other) {
        fail(meal, '最终数量或分类校验失败');
      }
      if (new Set(items.map(item => item.dishId)).size !== items.length) fail(meal, '出现重复菜品');
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
      dishCount: people <= 2 ? 2 : people + 1,
      stapleCount: 1,
      stapleQuantity: people,
      dessertOrOtherCount: 1
    },
    breakfastTemplate: {
      stapleQuantity: people,
      dishCount: Math.min(Math.max(people - 1, 0), 4),
      dishLimit: 4
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
    .filter(d => d.id !== currentDish.id && sameCategory(d));
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
    const existing = map.get(d.id) || { id: d.id, name: d.name, image: d.image, quantity: 0 };
    existing.quantity += Number(item.quantity || 1);
    map.set(d.id, existing);
  });
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}
