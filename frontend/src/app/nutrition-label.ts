export interface NutritionLabelValues {
  servingDescription: string | null;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  sugar: number | null;
  addedSugar: number | null;
}

/** Extract candidates only; the user must confirm every value against the photo. */
export function parseNutritionLabel(text: string): NutritionLabelValues {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/[|•]/g, ' ').replace(/\s+/g, ' ').trim());
  const valueOnLine = (pattern: RegExp): number | null => {
    for (const line of lines) {
      const match = line.match(pattern);
      if (!match) continue;
      const value = Number(match[1]);
      if (Number.isFinite(value) && value >= 0) return value;
    }
    return null;
  };
  const servingLine = lines.find((line) => /^serving\s*size\b/i.test(line));
  const servingDescription = servingLine
    ? servingLine.replace(/^serving\s*size\s*[:.]?\s*/i, '').trim().slice(0, 120) || null
    : null;
  const addedSugar = valueOnLine(/^\s*(?:includes?\s+)?added sugars?\s*[:.]?\s*(\d+(?:\.\d+)?)\s*g?\b/i)
    ?? valueOnLine(/^\s*includes?\s+(\d+(?:\.\d+)?)\s*g\s+added sugars?\b/i);
  return {
    servingDescription,
    calories: valueOnLine(/^\s*(?:calories|energy)\s*[:.]?\s*(\d+(?:\.\d+)?)\b/i),
    fat: valueOnLine(/^\s*(?:total\s+)?fat\s*[:.]?\s*(\d+(?:\.\d+)?)\s*g?\b/i),
    carbs: valueOnLine(/^\s*(?:total\s+)?carbohydrates?\s*[:.]?\s*(\d+(?:\.\d+)?)\s*g?\b/i),
    protein: valueOnLine(/^\s*protein\s*[:.]?\s*(\d+(?:\.\d+)?)\s*g?\b/i),
    sugar: valueOnLine(/^\s*(?:total\s+)?sugars?\s*[:.]?\s*(\d+(?:\.\d+)?)\s*g?\b/i),
    addedSugar,
  };
}
