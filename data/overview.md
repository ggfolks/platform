# Unified distributed data store

Historically, application data has been split across multiple tiers, with transformations taking
place as it moves from database server to application server to client. If multiple clients access
shared/distributed data, that often adds yet another data model and set of transformations. The
UDDS aims to radically simplify things by providing a single data model which is used for
persistent data, distributed data, and ephemeral data that exists only briefly on a single client.

The data store consists of objects (schema’d but flexible collections of key/value pairs) and
collections of objects (mappings from key to object) arranged in a tree structure rooted in a
single object. Every object is uniquely addressed by a path composed of keys from the root object,
through intermediate collections and objects to the object in question.

## Example chat app

Many of the concepts are most easily understood by example. We’ll use a simple chat app that has
users and rooms, and users can join rooms and send messages to one another. The app might define a
data model along these lines:

* users - collection defined on root object
    * `<id>` - unique key identifying an object in the “users” collection
        * username - a string property on the user object
        * lastLogin - a timestamp property on the user object
        * etc.
* rooms - collection defined on root object
    * `<id>` - unique key identifying an object in the “rooms” collection
        * name - a string property on the room object
        * messages - a collection property on the room object
            * `<id>` (unique key identifying an object in the “messages” collection)
                * text - a string property on the message object
                * sender - an id property on the message object (corresponds to id of author)
                * sent - a timetstamp property on the message object
        * users - a map property on the room object, contains a mapping from id to a
                  record {username :string, online :boolean}
        * roomq - a queue property (see below) on the room object
* publicRooms - a set property on the root object
* chatq - a queue property on the root object

Things to note about the example: objects can contain data properties as well as collection
properties, collections can only contain objects. Object property keys are always strings,
collection keys may be strings, numbers or system assigned ids. A given collection must have keys
of a single type. Objects may not directly contain other objects, nor may collections directly
contain collections.

The data is also denormalized. Though there will be mechanisms for aggregating and processing data
short of downloading it all into a client first (via views, described below), joins and other
ad-hoc queries are not available. This shifts some burden onto the developer to replicate data
where appropriate, but provides a more straightforward cost model and enables data to be replicated
and distributed through different parts of the system without excess magic.

### Schema

A schema must be provided for a data model, which defines the tree structure of the entire data
store as well as the names and types of the properties of every persistent and distributed object.
The schema also defines access control rules which control which parties can read and/or update
data, and describes policies for partitioning data among backend data stores as well as for how
data is replicated to clients.

The above example schema would look something like (defined in pseudo-JSON here, but we may create a
custom grammar):

```js
{
  root: {
    properties: {
      publicRooms: {type: “set”, elem: “record”}
    }
    collections: {
      users: {key: “id”, object: “user”}
      rooms: {key: “id”, object: “room”}
    }
    queues: {
      chat: {handler: “/chat/handlers#handleChat”}
    }
    access: {
      read: “true”
    }
  }
  user: {
    properties: {
      username: {type: “string”}
      lastLogin: {type: “timestamp”}
    }
    access: {
      read: “true”
      write: {username: “auth.id == this.$key”}
    }
  }
  room: {
    properties: {
      name: {type: “string”}
      users: {type: “map”, key: “id”, value: “record”}
    }
    collections: {
      messages: {key: “id”, object: “message”}
    }
    queues: {
      room: {type: “queue”, handler: “/room/handlers#handleRoom”}
      meta: {type: “queue”, handler: “/room/handlers#handleMeta”}
    }
    access: {
      read: “this.users.containsKey(auth.id)”
    }
  }
  message: {
    properties: {
      text: {type: “string”}
      sender: {type: “id”}
      sent: {type: “timestamp”}
    }
    access: {
      read: “true”
      write: {text: “auth.id == this.sender”}
    }
  }
}
```

### Code

TODO

## Subscription

A client (whether that be code running in a web browser or in a Node.js process in a container on a
server) subscribes to objects to obtain access to their current state as well as to be able to
react to changes in object state. The data model is designed to be distributed, such that multiple
clients can subscribe to a single object and see changes made to that object immediately (modulo
network latency) and (modulo access control policies) make changes to the object via their proxy.

Clients may also subscribe to entire collections, such that they are notified when objects are
added to or removed from those collections, and automatically subscribed to the objects themselves
as well so that property changes on those objects are distributed to that client.

## Property types

Scalar valued properties are of the basic JavaScript types: `boolean`, `string`, and `number`.
(TODO: do we want to support integral types for non-JS clients.) They may also have a scalar valued
property of type `record` which is described below. Scalar valued properties are considered
immutable and are changed by assigning a complete new value to the property, which is then
propagated through the system.

Collection properties are also supported in the following forms: maps, sets and lists. The keys and
values of maps, and entries of sets and lists can be of the basic types, or `record`. (Note: can we
get JavaScript to do the right thing with `record` valued keys in a `Map`?) Changes to collection
properties are performed in a fine grained manner. Maps can add, update or delete individual
key/value mappings. Sets can add or remove elements. Lists insert, update or delete elements at a
given index, or append elements. Note that in the case of lists guarantees cannot be made as to the
order in which updates are performed, thus list properties tend to only be appropriate when a
single entity manages changes to the list.

### Records

A `record` is an aggregate of key/value pairs (like a POJO) where each key is a `string` and each
value is itself of basic type, `record` type, or an array of basic or `record` types. Records are
still essentially a single value type as far as the system is concerned. It is not possible to
update a single field in a scalar valued property that contains a record, nor can a record value be
mutated in place.

## Ephemeral objects

The UDDS data model is one of objects which contain "reactive" properties (scalar and collection
values on which changes can be observed). This model is useful not only for persistent and
distributed data, but also for incidental, ephemeral data that exists only on a single client. Thus
it is possible to create free-standing values of the reactive types which exist only in the local
VM and which can be used for any sort of reactive programming. The user interface library is a
prime example of where this is used.

## Queues, handlers and channels

In addition to properties, objects can define _queues_. These are FIFO collections of commands
which are intended to facilitate communication between different computational parts of a
distributed system. The most common use case is for an untrusted client to append commands to a
queue which is then processed by _handler_ code running trusted code in a VM on a cloud server.

Handlers are simply functions that are supplied with the object that contains the queue in
question, the value posted to the queue (often a `record` value), and info about the client that
posted the value. Most commonly, the handler will validate/interpret the command and make changes
to properties of the object that contains the queue.

In cases where a request/response communication is more appropriate, a command may contain a
response channel address, which the handler can use to deliver a response value to the client that
posted the queue value. The response channel makes use of a special "client" queue which uniquely
identifies the client in the entire system and commands for which are handled by code on that
client. This will all be wrapped in an API that makes sending a request/response style command and
responding to it no more syntactically cumbersome than making an async remote procedure call.

Note that handlers are essentially [virtual actors] in that routing a command to a handler is not
exposed in the abstraction, nor the VM on which the handler runs, nor is responsibility for loading
or saving the data that makes up the handler's context (the object). The handler is simple code
which usually has everything it needs to perform its operations and then completes.

Circumstances will inevitably arise where handlers must suspend their computations and/or forward
additional operations out to other handlers. This unavoidable complexity will be supported with
hopefully modest gymnastics wherein the code is partitioned into a sequence of commands which
operate on potentially disparate stores of data and potentially eventually deliver a response to
the original caller. By ensuring that all stages of the computation are reflected in queue
commands, the system can ensure that commands never fail due to network unavailability or other
transient application-irrelevant causes. In the event of computation node failure, for example,
aborted commands simply remain on the queue and are restarted when the object in question is
assigned to a new computation node.

It is pertitent to note that commands can be dispatched to queues using only the path to the object
that contains the queue and the name of the queue. It is not necessary to have a subscription to
the object that contains the queue in question.

There also exists a special queue that can be added to any object, called the `meta` queue. This
queue is delivered standard commands related to structural activity in the UDDS network,
specifically notifications when a client subscribes to the object in question, and unsubscribes
from it. Lifecycle events (object resolved, object shutting down) may also eventually be dispatched
to this queue, though the virtual actor abstraction conveniently omits lifecycle concerns, so that
may not be necessary.

## Computed Views
TBD

## Access control
TBD


[virtual actors]: https://www.microsoft.com/en-us/research/publication/orleans-distributed-virtual-actors-for-programmability-and-scalability/
