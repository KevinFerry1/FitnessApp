import { parseNutritionLabel } from './nutrition-label';

describe('parseNutritionLabel', () => {
  it('extracts per-serving values from a typical US label', () => {
    expect(parseNutritionLabel('Nutrition Facts\n8 servings per container\nServing size 2/3 cup (55g)\nCalories 230\nTotal Fat 8g 10%\nSaturated Fat 1g\nTotal Carbohydrate 37g 13%\nProtein 3g')).toEqual({
      servingDescription: '2/3 cup (55g)', calories: 230, fat: 8, carbs: 37, protein: 3,
      sugar: null, addedSugar: null,
    });
  });

  it('leaves unreadable fields empty instead of guessing', () => {
    expect(parseNutritionLabel('Serving Size: 1 bar\nCalories 190\nTotal Fat 7g')).toEqual({
      servingDescription: '1 bar', calories: 190, fat: 7, carbs: null, protein: null,
      sugar: null, addedSugar: null,
    });
  });

  it('does not confuse saturated fat with total fat', () => {
    expect(parseNutritionLabel('Saturated Fat 3g\nProtein 10g').fat).toBeNull();
  });

  it('keeps added sugar separate from total sugar', () => {
    const values = parseNutritionLabel('Total Sugars 12g\nIncludes 8g Added Sugars');
    expect(values.sugar).toBe(12);
    expect(values.addedSugar).toBe(8);
  });

  it('loads the self-hosted OCR engine and recognizes a clear label', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 450;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'black';
    context.font = 'bold 44px Arial';
    ['Nutrition Facts', 'Serving size 1 cup', 'Calories 230', 'Total Fat 8g', 'Protein 3g']
      .forEach((line, index) => context.fillText(line, 35, 70 + index * 75));
    const ocr = await import('tesseract.js');
    const createWorker = (ocr as unknown as { default?: typeof ocr }).default?.createWorker ?? ocr.createWorker;
    const worker = await createWorker('eng', 1, {
      workerPath: '/ocr/worker.min.js', corePath: '/ocr/core', langPath: '/ocr/lang',
    });
    try {
      const text = (await worker.recognize(canvas)).data.text;
      expect(parseNutritionLabel(text).calories).toBe(230);
    } finally { await worker.terminate(); }
  }, 120000);
});
