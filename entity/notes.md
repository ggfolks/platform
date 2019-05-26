# Entity notes

- A traditional ECS framework has the following structure:

    - entities are collections of components
    - components are "dumb" collections of data
    - entities have a lifecycle: created, enabled, disabled, destroyed
    - systems combine entity "queries" (select entities with some required set of components) and
      code that operates on those entities (every frame and during entity lifecycle events)

- Unity and MVRS took a more "object oriented" approach:

    - entities are collections of components (called behaviors in Unity, aspects/behaviors in MVRS)
    - components are abstract classes instantiated for every entity instance
        - they can maintain their own data in member properties or they can read and update shared
          data maintained by the entity
        - they have abstract methods for lifecycle hooks as well as frame update
    - systems don't really exist, though mechanisms may be provided to tag entities and look up
      sibling entities via tag or other query-like mechanisms

- I'd like to lean toward the traditional structure with tfw.entity:

    - entities are an id, a collection of components, a collection of properties, have lifecycle
    - the id is an integer used to identify the entity in some places
    - components are tags with optional config data
    - properties are either simple boxes for data or proxies for data source elsewhere
    - systems are abstract classes
        - they define the criteria for their entity set
        - methods are called on systems for lifecycle and frame events, passing the relevant entity
          or entity set
        - systems also have lifecycle (created, enabled, disabled, destroyed)

- The properties abstraction allows us to federate data from tfw.data and tfw.space into the entity
  model without tight coupling and without duplicating data, for example:

  - a standard property for entities which have a 3D visualization will be a Transform; various
    systems will read this transform, some may update it
  - in a non-networked game, the Transform may be instantiated as a simple POJO which contains
    position, rotation and scale properties, or it might be a proxy to flat arrays which contain
    all entity transforms in a format better suited to bulk processing, or transfer to/from the
    physics worker
  - in a networked game, the Transform can be an object managed by tfw.space such that transform
    changes are synced with the server & shared among clients
  - similar transparent proxying/syncing can be done for tfw.data data sources for non-interpolated
    entity properties

- The emphasis on having code in systems rather than in abstract behavior classes strongly
  encourages data to be stored as entity properties rather than in behavior instance members and it
  plays more nicely with the code hot reloading system. Systems tend not to have any data, so
  reloading their code is less prone to cause errors relating to cleanup and reinitialization. The
  state lives in the entities which don't change.

  This also harmonizes with the more widespread philosophy in all of tfw's libraries that data is
  stored separately from code: tfw.data just manages a distributed reactive data store, tfw.space
  just manages distributed interpolated data spaces, tfw.entity encourages entities to be dumb
  collections of data and config that code operates on.

- The data model for a "scene" might then be a config object describing the scene, which contains
  config objects describing systems and config objects describing any "pre-fab" entities in the
  scene. Some systems would simply operate on whatever entities that happened to be created in the
  scene, others would cause entities to be created and destroyed.

- A system config might itself contain one or more "prototypes" for the entities it creates. One
  could, for example, have a "mob spawning" system that had its own config (spawn rate, trigger
  conditions, etc.) and contained nested config objects for the config of the (dynamic) mob
  entities instantiated by that system. A scene could contain many (static) "instances" of the mob
  spawning system, each configured as desired for its purposes.

- One might be inclined to think "the mob spawner is like an entity itself, we'll want to place
  it's spawn point in the scene as a static entity, it should be an entity". A better solution is
  to have the mob spawning system also reference a static "spawn point" entity, defined in the main
  scene config. The important principle is that systems manage entities (and have code), but
  entities do not manage other entities, they are just data. Systems could conceivably spawn other
  systems, though I suspect any design that made use of this could also be designed as a single
  system and probably more simply. Such bridges can be crossed when we come to them.
