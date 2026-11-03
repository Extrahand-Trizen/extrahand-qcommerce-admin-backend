export function mergeResubmittedProductImages(
  existingImages: string[] | undefined,
  previousFrontImage: string | undefined,
  previousIngredientsImage: string | undefined,
  currentFrontImage: string | undefined,
  currentIngredientsImage: string | undefined,
  replaceFrontImage: boolean,
  replaceIngredientsImage: boolean,
): string[] {
  const replacedImages = new Set<string>();
  if (replaceFrontImage && previousFrontImage) replacedImages.add(previousFrontImage);
  if (replaceIngredientsImage && previousIngredientsImage) {
    replacedImages.add(previousIngredientsImage);
  }

  return [...new Set([
    currentFrontImage,
    ...(existingImages || []).filter((image) => !replacedImages.has(image)),
    currentIngredientsImage,
  ].filter(Boolean) as string[])];
}
