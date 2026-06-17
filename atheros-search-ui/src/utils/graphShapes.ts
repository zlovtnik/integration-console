export function polygonPath(
  radius: number,
  sides: number,
  rotation = -Math.PI / 2,
): string {
  const points = Array.from({ length: sides }, (_, index) => {
    const angle = rotation + (index * Math.PI * 2) / sides;
    return `${round(Math.cos(angle) * radius)},${round(Math.sin(angle) * radius)}`;
  });
  return `M${points.join('L')}Z`;
}

export function circlePath(radius: number): string {
  return `M${-radius},0a${radius},${radius} 0 1,0 ${radius * 2},0a${radius},${radius} 0 1,0 ${-radius * 2},0`;
}

function round(value: number): number {
  return Number(value.toFixed(2));
}
