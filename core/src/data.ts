
export type Record = Object

export type Data = boolean | number | string | Record

export function dataEquals (a :Data, b :Data) :boolean {
  if (a === b) return true
  // TODO: structural equality for records, all the necessary type machinations
  return false
}
