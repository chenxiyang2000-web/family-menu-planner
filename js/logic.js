import { healthStandards } from './storage.js';

export const slotKey = (day, meal) => `${day}|${meal}`;
export const dayIndexes = plan => Array.from({ length: Number(plan.days) }, (_, i) => i);
export const getSlot = (plan, day, meal) => plan.slots[slotKey(day, meal)] || [];
export const dishOf = (state, item) => state.dishes.find(d => d.id === item.dishId);
export const currentPlan = state => state.plans.find(p => p.id === state.currentPlanId) || state.plans[0];
export const isNoodleStaple = dish => dish?.category === '主食' && String(dish.name || '').trim().endsWith('面');

export function eligible(state, plan, meal, excluded = new Set(), category = '') {
  const dislikes = String(plan.dislike || '').split(/[，,、\s]+/).filter(Boolean);
  const cuisines = Array.isArray(plan.cuisines) ? plan.cuisines : [];
  const maxSpicy = Math.max(0, Math.min(5, Number(plan.maxSpicy ?? 5)));
  const matches = state.dishes.filter(d =>
    (!category || d.category === category) &&
    d.meals.includes(meal) &&
    d.servingOptions.map(Number).includes(Number(plan.people)) &&
    (!cuisines.length || cuisines.includes(d.cuisine)) &&
    Number(d.spicyLevel || 0) <= maxSpicy &&
    !dislikes.some(word => d.name.includes(word) || d.ingredients.some(i => i.includes(word)))
  );
  const fresh = matches.filter(d => !excluded.has(d.id));
  return fresh.length ? fresh : matches;
}

function score(dish, plan, mealDishes, adjustment = 0) {
  let value = Math.random() * 4 + (dish.favorite ? 5 : 0);
  if (plan.goal === '清淡' && (dish.healthTags.includes('清淡') || dish.healthTags.includes('低油'))) value += 7;
  if (plan.goal === '高蛋白' && dish.healthTags.includes('高蛋白')) value += 7;
  if (plan.goal === '低糖' && dish.healthTags.includes('低糖')) value += 7;
  if (mealDishes.some(d => d.category === dish.category)) value -= 4;
  return value + adjustment;
}

function strictCandidates(state, plan, meal, category = '') {
  return eligible(state, plan, meal, new Set(), category)
    .filter(d => d.category !== '超大菜');
}

function pickWithBudget(
  state,
  plan,
  meal,
  used,
  mealDishes,
  dayUsed,
  category,
  remainingBudget,
  remainingSlots,
  {
    allowNoodle = true,
    previousDayHadNoodle = false
  } = {}
) {
  const mealIds = new Set(mealDishes.map(d => d.id));
  let candidates = strictCandidates(state, plan, meal, category)
    .filter(d => !mealIds.has(d.id))
    .filter(d => !dayUsed.has(d.id))
    .filter(d => allowNoodle || !isNoodleStaple(d));
  if(!candidates.length)return null;
  const globallyFresh = candidates.filter(d => !used.has(d.id));
  const keepAllStaplesForSpacing = previousDayHadNoodle && category === '主食';
  if (globallyFresh.length && !keepAllStaplesForSpacing) candidates = globallyFresh;
  const adjustedScore = dish => score(
    dish,
    plan,
    mealDishes,
    (previousDayHadNoodle && isNoodleStaple(dish) ? -8 : 0) +
    (keepAllStaplesForSpacing && !used.has(dish.id) ? 2 : 0)
  );
  if(!Number(plan.budget))return candidates.sort((a,b)=>adjustedScore(b)-adjustedScore(a))[0];
  const allowance=Math.max(0,remainingBudget)/Math.max(1,remainingSlots);
  const affordable=candidates.filter(d=>Number(d.price||0)<=allowance*1.15);
  const pool=affordable.length?affordable:candidates;
  return pool.sort((a,b)=>{
    const priceDifference=Number(a.price||0)-Number(b.price||0);
    return affordable.length ? adjustedScore(b)-adjustedScore(a) : priceDifference;
  })[0];
}

export function distributeSelected(state, plan, selectedIds) {
  const slots = structuredClone(plan.slots || {});
  const targets = dayIndexes(plan).flatMap(day => plan.meals.map(meal => ({ day, meal })));
  const noodleDays = new Set();
  Object.entries(slots).forEach(([key, items]) => {
    if (items.some(item => isNoodleStaple(dishOf(state, item)))) {
      noodleDays.add(Number(key.split('|')[0]));
    }
  });
  selectedIds.forEach((dishId, index) => {
    const d = state.dishes.find(item => item.id === dishId);
    const compatible = targets.filter(t => d?.meals.includes(t.meal));
    if (!compatible.length) return;
    const target = isNoodleStaple(d)
      ? compatible.find(item => !noodleDays.has(item.day)) || compatible[index % compatible.length]
      : compatible[index % compatible.length];
    if (isNoodleStaple(d)) noodleDays.add(target.day);
    const key = slotKey(target.day, target.meal);
    slots[key] = [...(slots[key] || []), {
      dishId,
      quantity:d.category === '主食' ? Number(plan.people) : 1,
      locked:false
    }];
  });
  return slots;
}

export function buildSelectedPlan(state, plan, selectedIds, autoFill = false) {
  const selectedSlots = distributeSelected(state, plan, selectedIds);
  if (!autoFill) return selectedSlots;
  const preexistingNoodleDays = new Set();
  const preexistingNoodleSlots = new Set();
  const noodleBlockedSlots = new Set();
  Object.entries(selectedSlots).forEach(([key, items]) => {
    if (!items.length) return;
    if (items.some(item => isNoodleStaple(dishOf(state, item)))) {
      preexistingNoodleDays.add(Number(key.split('|')[0]));
      preexistingNoodleSlots.add(key);
    } else {
      noodleBlockedSlots.add(key);
    }
  });
  const generatedSlots = generateCompletePlan(state, plan, {
    preexistingNoodleDays,
    preexistingNoodleSlots,
    noodleBlockedSlots
  });
  const merged = structuredClone(selectedSlots);
  const globallyUsed = new Set(Object.values(merged).flat().map(item => item.dishId));
  for (const [key, generatedItems] of Object.entries(generatedSlots)) {
    const meal = key.split('|')[1];
    const existing = [...(merged[key] || [])];
    existing.forEach(item => {
      if (dishOf(state,item)?.category === '主食') item.quantity = Number(plan.people);
    });
    const existingHasNoodle = existing.some(item => isNoodleStaple(dishOf(state,item)));
    const generatedNoodle = generatedItems.find(item => isNoodleStaple(dishOf(state,item)));
    if (existingHasNoodle) {
      merged[key] = existing;
      continue;
    }
    if (generatedNoodle) {
      merged[key] = existing.length ? existing : [generatedNoodle];
      continue;
    }
    const existingIds = new Set(existing.map(item => item.dishId));
    const targetCounts = new Map();
    const currentCounts = new Map();
    const templates = new Map();
    generatedItems.forEach(item => {
      const category = dishOf(state, item)?.category || '';
      targetCounts.set(category, (targetCounts.get(category) || 0) + 1);
      if (!templates.has(category)) templates.set(category, item);
    });
    existing.forEach(item => {
      const category = dishOf(state, item)?.category || '';
      currentCounts.set(category, (currentCounts.get(category) || 0) + 1);
    });
    for (const [category,targetCount] of targetCounts) {
      while ((currentCounts.get(category) || 0) < targetCount) {
        const generated = generatedItems.find(item =>
          dishOf(state,item)?.category === category &&
          !existingIds.has(item.dishId) &&
          !globallyUsed.has(item.dishId)
        );
        let item = generated;
        if (!item) {
          const fresh = eligible(state,plan,meal,globallyUsed,category)
            .find(d=>d.category!=='超大菜'&&!globallyUsed.has(d.id));
          const reusable = fresh || eligible(state,plan,meal,new Set(),category)
            .find(d=>d.category!=='超大菜'&&!existingIds.has(d.id));
          if (!reusable) break;
          const template = templates.get(category) || {};
          item = {
            dishId:reusable.id,
            quantity:Number(template.quantity || 1),
            servings:Number(plan.people),
            locked:false
          };
        }
        existing.push(item);
        existingIds.add(item.dishId);
        globallyUsed.add(item.dishId);
        currentCounts.set(category,(currentCounts.get(category)||0)+1);
      }
    }
    merged[key] = existing;
  }
  return merged;
}

export function generateCompletePlan(state, plan, options = {}) {
  const slots = {}, used = new Set();
  const ratios = healthStandards[plan.goal] || healthStandards['均衡'];
  const people=Number(plan.people);
  const dishCount=people<=2?2:people+1;
  const meatVegetableTotal=ratios.meat+ratios.vegetable || 1;
  const meatCount=Math.max(1,Math.min(dishCount-1,Math.round(dishCount*ratios.meat/meatVegetableTotal)));
  const vegetableCount=dishCount-meatCount;
  const categoryOrder=['肉菜','蔬菜','主食','甜品','汤饮'];
  const generatedCounts={meat:0,vegetable:0,staple:0,other:0};
  const slotsPerDay=plan.meals.reduce((sum,meal)=>sum+(meal==='早餐'?Math.min(Math.max(people-1,0),4)+1:dishCount+2),0);
  const totalPlannedSlots=Number(plan.days)*slotsPerDay;
  let remainingBudget=Number(plan.budget)||Infinity,remainingSlots=totalPlannedSlots,estimatedCost=0;
  const preexistingNoodleDays=options.preexistingNoodleDays || new Set();
  const preexistingNoodleSlots=options.preexistingNoodleSlots || new Set();
  const noodleBlockedSlots=options.noodleBlockedSlots || new Set();
  let previousDayHadNoodle=false;

  const addFromCategory=(meal,mealDishes,dayUsed,category,quantity=1,pickOptions={}) => {
    const selected=pickWithBudget(
      state,plan,meal,used,mealDishes,dayUsed,category,
      remainingBudget,remainingSlots,pickOptions
    );
    if(!selected)return null;
    used.add(selected.id);dayUsed.add(selected.id);mealDishes.push(selected);
    const selectedPrice=Number(selected.price||0)*quantity;estimatedCost+=selectedPrice;
    if(Number.isFinite(remainingBudget))remainingBudget-=selectedPrice;
    remainingSlots=Math.max(0,remainingSlots-1);
    return {dishId:selected.id,quantity,servings:people,locked:false};
  };

  const failIncomplete=(meal,detail)=>{
    throw new Error(`${meal}无法生成完整菜单：${detail}。请补充符合人数、餐次、菜系和辣度条件的菜品后重试。`);
  };

  const sortItems=items=>items.sort((a,b)=>{
    const aIndex=categoryOrder.indexOf(dishOf(state,a)?.category);
    const bIndex=categoryOrder.indexOf(dishOf(state,b)?.category);
    return (aIndex<0?categoryOrder.length:aIndex)-(bIndex<0?categoryOrder.length:bIndex);
  });

  for (const day of dayIndexes(plan)) {
    let dayHasNoodle=preexistingNoodleDays.has(day);
    const dayUsed=new Set();
    for (const meal of plan.meals) {
      const key=slotKey(day,meal),mealDishes=[],items=[];
      if(preexistingNoodleSlots.has(key)){slots[key]=[];continue}
      const staple=addFromCategory(meal,mealDishes,dayUsed,'主食',people,{
        allowNoodle:!dayHasNoodle&&!noodleBlockedSlots.has(key),
        previousDayHadNoodle
      });
      if(!staple)failIncomplete(meal,'没有可用主食');
      if(staple){
        generatedCounts.staple+=people;
        if(isNoodleStaple(dishOf(state,staple))){
          dayHasNoodle=true;
          slots[key]=[staple];
          continue;
        }
      }
      if(meal==='早餐'){
        const breakfastDishCount=Math.min(Math.max(people-1,0),4);
        const breakfastMeatCount=Math.round(breakfastDishCount*ratios.meat/meatVegetableTotal);
        const breakfastVegetableCount=breakfastDishCount-breakfastMeatCount;
        const breakfastTargets=[
          ...Array(breakfastMeatCount).fill('肉菜'),
          ...Array(breakfastVegetableCount).fill('蔬菜')
        ];
        for(const preferredCategory of breakfastTargets){
          const fallbackCategory=preferredCategory==='肉菜'?'蔬菜':'肉菜';
          let item=addFromCategory(meal,mealDishes,dayUsed,preferredCategory);
          if(!item)item=addFromCategory(meal,mealDishes,dayUsed,fallbackCategory);
          if(!item)failIncomplete(meal,`肉类/蔬菜候选不足，目标 ${breakfastDishCount} 道`);
          items.push(item);
          const actualCategory=dishOf(state,item)?.category;
          if(actualCategory==='肉菜')generatedCounts.meat++;else generatedCounts.vegetable++;
        }
        if(staple)items.push(staple);
        if(items.length!==breakfastDishCount+1)failIncomplete(meal,'生成数量校验失败');
        slots[key]=sortItems(items);
        continue;
      }
      const sideTargets=[
        ...Array(meatCount).fill('肉菜'),
        ...Array(vegetableCount).fill('蔬菜')
      ];
      for(const preferredCategory of sideTargets){
        const fallbackCategory=preferredCategory==='肉菜'?'蔬菜':'肉菜';
        let item=addFromCategory(meal,mealDishes,dayUsed,preferredCategory);
        if(!item)item=addFromCategory(meal,mealDishes,dayUsed,fallbackCategory);
        if(!item)failIncomplete(meal,`肉类/蔬菜候选不足，目标 ${dishCount} 道`);
        items.push(item);
        const actualCategory=dishOf(state,item)?.category;
        if(actualCategory==='肉菜')generatedCounts.meat++;else generatedCounts.vegetable++;
      }
      if(staple)items.push(staple);
      const preferOther=plan.goal==='清淡'||plan.goal==='低糖'||Math.random()<0.5;
      const otherOrder=preferOther?['汤饮','甜品','其他']:['甜品','汤饮','其他'];
      let last=null;
      for(const category of otherOrder){
        last=addFromCategory(meal,mealDishes,dayUsed,category);
        if(last)break;
      }
      if(!last)failIncomplete(meal,'没有可用的甜品、汤饮或其他菜品');
      items.push(last);generatedCounts.other++;
      if(items.length!==dishCount+2)failIncomplete(meal,'生成数量校验失败');
      if(new Set(items.map(item=>item.dishId)).size!==items.length)failIncomplete(meal,'出现重复菜品');
      slots[key]=sortItems(items);
    }
    previousDayHadNoodle=dayHasNoodle;
  }
  plan.generationProfile = {
    standard:plan.goal, ratios:{...ratios}, people,
    mealTemplate:{dishCount,stapleCount:1,stapleQuantity:people,dessertOrOtherCount:1},
    breakfastTemplate:{stapleQuantity:people,dishCount:Math.min(Math.max(people-1,0),4),dishLimit:4},
    generatedCounts,
    totalSlots:Object.values(slots).flat().length,
    budget:Number(plan.budget)||0,
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
  const standardCategories = ['肉菜','蔬菜','主食','甜品','超大菜'];
  const sameCategory = dish => {
    if (standardCategories.includes(currentDish.category)) return dish.category === currentDish.category;
    return !standardCategories.includes(dish.category);
  };
  const candidates = eligible(state,plan,targetMeal,new Set())
    .filter(d=>d.id!==currentDish.id&&sameCategory(d));
  const fresh = candidates.filter(d=>!used.has(d.id));
  const pool = fresh.length ? fresh : candidates;
  const replacement = pool[Math.floor(Math.random()*pool.length)];
  if (!replacement) return false;
  plan.slots[slotKey(day, meal)][index] = {...current,dishId:replacement.id};
  return true;
}

export function shoppingSummary(state, plan) {
  const map = new Map();
  Object.values(plan.slots).flat().filter(item => item.dishId).forEach(item => {
    const d = dishOf(state, item);
    if (!d) return;
    const existing = map.get(d.id) || { id:d.id, name:d.name, image:d.image, quantity:0 };
    existing.quantity += Number(item.quantity || 1);
    map.set(d.id, existing);
  });
  return [...map.values()].sort((a,b) => a.name.localeCompare(b.name, 'zh-CN'));
}
