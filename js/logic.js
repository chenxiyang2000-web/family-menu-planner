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

function score(dish, plan, dayDishes) {
  let value = Math.random() * 4 + (dish.favorite ? 5 : 0);
  if (plan.goal === '清淡' && (dish.healthTags.includes('清淡') || dish.healthTags.includes('低油'))) value += 7;
  if (plan.goal === '高蛋白' && dish.healthTags.includes('高蛋白')) value += 7;
  if (plan.goal === '低糖' && dish.healthTags.includes('低糖')) value += 7;
  if (dayDishes.some(d => d.category === dish.category)) value -= 4;
  return value;
}

function pick(state, plan, meal, used, dayDishes, category = '') {
  return eligible(state, plan, meal, used, category)
    .filter(d => d.category !== '超大菜')
    .filter(d => !dayDishes.some(existing => existing.id === d.id))
    .sort((a,b) => score(b, plan, dayDishes) - score(a, plan, dayDishes))[0];
}

function pickWithBudget(state, plan, meal, used, dayDishes, category, remainingBudget, remainingSlots) {
  const candidates=eligible(state,plan,meal,used,category)
    .filter(d=>d.category!=='超大菜')
    .filter(d=>!dayDishes.some(existing=>existing.id===d.id));
  if(!candidates.length)return null;
  if(!Number(plan.budget))return candidates.sort((a,b)=>score(b,plan,dayDishes)-score(a,plan,dayDishes))[0];
  const allowance=Math.max(0,remainingBudget)/Math.max(1,remainingSlots);
  const affordable=candidates.filter(d=>Number(d.price||0)<=allowance*1.15);
  const pool=affordable.length?affordable:candidates;
  return pool.sort((a,b)=>{
    const priceDifference=Number(a.price||0)-Number(b.price||0);
    return affordable.length ? score(b,plan,dayDishes)-score(a,plan,dayDishes) : priceDifference;
  })[0];
}

export function distributeSelected(state, plan, selectedIds) {
  const slots = structuredClone(plan.slots || {});
  const targets = dayIndexes(plan).flatMap(day => plan.meals.map(meal => ({ day, meal })));
  selectedIds.forEach((dishId, index) => {
    const d = state.dishes.find(item => item.id === dishId);
    const compatible = targets.filter(t => d?.meals.includes(t.meal));
    if (!compatible.length) return;
    const target = compatible[index % compatible.length];
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
  const generatedSlots = generateCompletePlan(state, plan);
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

export function generateCompletePlan(state, plan) {
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

  const addFromCategory=(meal,dayDishes,category,quantity=1) => {
    const selected=pickWithBudget(state,plan,meal,used,dayDishes,category,remainingBudget,remainingSlots);
    if(!selected)return null;
    used.add(selected.id);dayDishes.push(selected);
    const selectedPrice=Number(selected.price||0)*quantity;estimatedCost+=selectedPrice;
    if(Number.isFinite(remainingBudget))remainingBudget-=selectedPrice;
    remainingSlots=Math.max(0,remainingSlots-1);
    return {dishId:selected.id,quantity,servings:people,locked:false};
  };

  for (const day of dayIndexes(plan)) {
    for (const meal of plan.meals) {
      const key=slotKey(day,meal),dayDishes=[],items=[];
      const staple=addFromCategory(meal,dayDishes,'主食',people);
      if(staple){
        generatedCounts.staple+=people;
        if(isNoodleStaple(dishOf(state,staple))){
          slots[key]=[staple];
          continue;
        }
      }
      if(meal==='早餐'){
        const breakfastDishCount=Math.min(Math.max(people-1,0),4);
        const breakfastMeatCount=Math.round(breakfastDishCount*ratios.meat/meatVegetableTotal);
        const breakfastVegetableCount=breakfastDishCount-breakfastMeatCount;
        for(let i=0;i<breakfastMeatCount;i++){const item=addFromCategory(meal,dayDishes,'肉菜');if(item){items.push(item);generatedCounts.meat++}}
        for(let i=0;i<breakfastVegetableCount;i++){const item=addFromCategory(meal,dayDishes,'蔬菜');if(item){items.push(item);generatedCounts.vegetable++}}
        const breakfastFallbackOrder=ratios.vegetable>=ratios.meat?['蔬菜','肉菜']:['肉菜','蔬菜'];
        while(items.length<breakfastDishCount){
          let added=false;
          for(const category of breakfastFallbackOrder){
            const item=addFromCategory(meal,dayDishes,category);
            if(!item)continue;
            items.push(item);
            if(category==='肉菜')generatedCounts.meat++;else generatedCounts.vegetable++;
            added=true;
            break;
          }
          if(!added)break;
        }
        if(staple)items.push(staple);
        slots[key]=items.sort((a,b)=>categoryOrder.indexOf(dishOf(state,a)?.category)-categoryOrder.indexOf(dishOf(state,b)?.category));
        continue;
      }
      for(let i=0;i<meatCount;i++){const item=addFromCategory(meal,dayDishes,'肉菜');if(item){items.push(item);generatedCounts.meat++}}
      for(let i=0;i<vegetableCount;i++){const item=addFromCategory(meal,dayDishes,'蔬菜');if(item){items.push(item);generatedCounts.vegetable++}}
      if(staple)items.push(staple);
      const preferOther=plan.goal==='清淡'||plan.goal==='低糖'||Math.random()<0.5;
      let last=addFromCategory(meal,dayDishes,preferOther?'汤饮':'甜品');
      if(last){items.push(last);generatedCounts.other++}
      slots[key]=items.sort((a,b)=>categoryOrder.indexOf(dishOf(state,a)?.category)-categoryOrder.indexOf(dishOf(state,b)?.category));
    }
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
