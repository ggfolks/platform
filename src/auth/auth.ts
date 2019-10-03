import {UUID, UUID0, uuidv1} from "../core/uuid"
import {Mutable, Subject} from "../core/react"

/** The source for unauthenticated (guess) credentials. */
export const GuestAuth = "guest"

/** Provides authentication information when connecting to a server. */
export type SessionAuth = {
  source :string,
  id :UUID,
  token :string,
}

const authKey = "_auth"
const haveLocalStorage = typeof localStorage !== "undefined"

function initialAuth () :SessionAuth {
  if (haveLocalStorage) {
    const localAuth = localStorage.getItem(authKey)
    if (localAuth) {
      const auth = JSON.parse(localAuth)
      if (typeof auth.id === "string" && typeof auth.token === "string") return auth
    }
  }
  return {source: "guest", id: uuidv1(), token: ""}
}

/** The current authentication information for this client. External auth providers should update
  * this value when they obtain auth information. Services that require auth information should
  * listen to this value to hear about current and future auth states. */
export const sessionAuth = Mutable.localData<SessionAuth>(initialAuth())

/** Resets the session to a guest session, reusing this client's preferred guest id if possible. */
export function resetAuth () {
  sessionAuth.update(initialAuth())
}

if (haveLocalStorage) {
  sessionAuth.onValue(auth => {
    if (auth.source === "guest") localStorage.setItem(authKey, JSON.stringify(auth))
    // TEMP: not sure we want to delete our "preferred" guest ID when we auth...
    // else localStorage.removeItem(authKey)
  })
}

/** Provides auth information to distributed object handlers & access controls. */
export type Auth = {
  id :UUID
  isGuest :boolean
  isSystem :boolean
  // TODO: change this to something extensible like: hasToken("admin"|"support"|"system")
  // or maybe those tokens are named "isAdmin" etc. and are jammed into this object...
}

export const noAuth = {id: UUID0, isGuest: false, isSystem: false}

/** Handles validation of auth credentials in server code. */
export interface AuthValidator {

  /** Validates authentication info provided by a client.
    * @return a subject that yields an `Auth` instance iff the supplied info is valid. If it is
    * invalid, a warning should be logged and the subject should not complete. */
  validateAuth (id :UUID, token :string) :Subject<Auth>
}

/** A validator for guest authentication. */
export const guestValidator :AuthValidator = {
  validateAuth (id :UUID, token :string) :Subject<Auth> {
    return Subject.constant({id, isGuest: true, isSystem: false})
  }
}
