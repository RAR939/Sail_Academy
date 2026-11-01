/** Wind direction is where wind comes from; x/z are world coordinates. */
export function apparentWindFlow(direction: number, speed: number, heading: number, boatSpeed: number): { x: number; z: number } {
  return {
    x: -Math.sin(direction) * speed - Math.sin(heading) * boatSpeed,
    z: -Math.cos(direction) * speed - Math.cos(heading) * boatSpeed,
  };
}

/** Keep the last side near head-to-wind to prevent noisy snapshot flicker. */
export function sailSideForWind(direction: number, heading: number, previous: number): number {
  const side = Math.sin(direction - heading);
  return Math.abs(side) > 0.08 ? Math.sign(side) : previous;
}
