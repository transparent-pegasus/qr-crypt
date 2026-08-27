type InterpolationValue = string | number
export type InterpolationValues = Readonly<Record<string, InterpolationValue>>

export function interpolateMessage(
  template: string,
  values: InterpolationValues = {},
): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (placeholder, name: string) => {
    const value = values[name]
    return value === undefined ? placeholder : String(value)
  })
}
