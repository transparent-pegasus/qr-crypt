let artifactCounter = 0
let keyCounter = 0

export function nextArtifactCounter(): number {
  artifactCounter += 1
  return artifactCounter
}

export function nextKeyCounter(): number {
  keyCounter += 1
  return keyCounter
}

export function resetFakeCounters(): void {
  artifactCounter = 0
  keyCounter = 0
}
