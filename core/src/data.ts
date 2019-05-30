
interface DataArray extends Array<Data> {}
interface DataSet extends Set<Data> {}
export interface Record { [key :string] :Data }

export type Data = void | boolean | number | string | DataArray | DataSet | Record

export function dataEquals (a :Data, b :Data) :boolean {
  if (a === b) return true
  // TODO: structural equality for records, all the necessary type machinations
  return false
}

export function isSet (value :Data) :boolean {
  // TODO: can we get away with only using instanceof Set? probably not...
  return value instanceof Set || (
    value !== null && typeof value === 'object' && value.constructor.name === 'Set')
}
