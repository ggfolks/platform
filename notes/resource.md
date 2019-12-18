# Resource system

The resource system manages a collection of _resources_ (media, source files, configuration data,
etc.) which combine together to form a game or application. A game or application obtains its
resources from a _workspace_ that groups all resources for that game or application. Workspaces can
also branch from other workspaces, which allows multiple people to work on resources for a game
without stepping on one another's toes.

## Workspaces

Workspaces serve a few purposes:

  * they collect all the resources for a particular game/app together
  * they organize those resources into a directory structure (which is mainly used for human
    navigation but in the case of source code is also used when resolving resources)
  * they track the change history of all resources within themselves (mostly for auditing purposes,
    but this can also be used to "revert" recent changes)
  * they form a collaborative working protocol like that of a distributed version control system
  * snapshots of them can be taken to create _releases_

A workspace has the following data:

  * id - a UUID that identifies this workspace and is used to identify upstream workspaces for
    branches
  * name - a human readable name, just used for UI purposes
  * owner - TBD access control mechanism (workspaces may be owned by individuals or teams)
  * upstreamId - the UUID of the workspace from which this workspace was branched (if any)
  * changeHistory - an append-only log of changes made to resources in this workspace
  * resources - a collection of all resources in this workspace, by UUID
  * dirs - a collection of all directories in this workspace, by UUID
  * rootDir - the UUID of the root directory of the workspace

A directory is represented by a distributed object, which contains:

  * resources - a map from name to UUID of resources in this directory
  * subdirs - a map from name to UUID of all sub-directories of this directory

### Syncing with upstream

Like distributed version control systems, resources are "pushed" upstream from branches when they
are ready to be shared and pulled from upstream to merge in changes from other users. This will be
accomplished via a workspace browser app which displays the contents of a workspace and potentially
embeds editors for different types of resources.

Pulling changes from upstream will merge all newer upstream resources into a user's branched
workspace, and will prompt the user to manually choose their version or the upstream version in the
case where both the upstream resource and the branched resource were modified since the last pull.
No diffing will be done, but we should be able to launch two viewers/editors to allow the user to
see what has changed.

Pushing changes upstream will only be allowed if the to-be-pushed resources are safely synced with
the latest versions of the upstream workspace. Then it is simply a matter of updating the hashes
and data of the upstream resources with the branched resources and deleting the branched resources.
Resources that do not differ from upstream resources are not "materialized" in the branched
workspace, which makes branching cheap and fast.

### End-user branches

Part of the motivation for making workspace branches cheap is to eventually support games which
support modding by allowing end-users to create workspace branches. This will require more
sophisticated access control, and undoubtedly resolving various complications that crop up, but we
are at least not introducing barriers to this feature with our architectural choices.

## Resources

A resource represents a single building block of a game: an image file, a GLB file, an audio file,
a JavaScript source file, or a file containing configuration data (used by the various config
system-based editors).

A resource has the following data:

  * id - a UUID that uniquely identifies this resource and which can be embedded in config data to
    link to this resource
  * mimeType - the standard mime type for media or source code, and platform-specific mime types
    for configuration data
  * name - a human readable name for the resource (like a filename for a file); resources can be
    resolved by path + name in certain circumstances
  * created - a timestamp indicating when this resource was created
  * lastModified - a timestamp indicating when this resource was last modified
  * data - the UTF8 contents of the resource for inline resources (source code, or JSON for
    configuration data); not used by media resources which are stored externally
  * hash - the SHA1 hash of the payload of this resource; if the resource data is stored in an
    external repository (like AWS S3), this will be the hash of that data and will be used to
    construct a URL to load that data; if this is an inline resource, it is a SHA1 hash of the
    `data` property
  * sourceHash - the hash of the upstream resource from the last time this resource's workspace was
    synced; this is used to manage pushing to and pulling from upstream workspaces

## Release workflow

A particular game will have a single workspace that acts as its development (dev) or bleeding edge
version, from which each developer working on that game will create a branch workspace. This will
allow them to push changes to the dev workspace and pull changes pushed by other developers.
Instances of the game will be configured using the dev workspace as well as each developer's branch
workspace, allowing anyone to play the current dev version or anyone else's in progress but
unpushed branch version.

At any time, a _snapshot_ of the dev workspace can be created and a staging or test version of the
game can be updated to use that new snapshot. In this way, releases can be tested prior to
shipping. Finally a test snapshot can be promoted to production by configuring the production
servers to use a vetted snapshot. This process will be automated by virtue of creating named
"builds" and providing a UI for configuring which snapshot is associated with each build. The
runtime resource management code will detect a change to the snapshot associated with the build and
will instruct the game to update itself in whatever way is desired for that build (be that
rebooting, or hot reloading, or some other policy).

We won't have support for sophisticated patching of past snapshots. We may provide some way to
specifically patch one resource at a time, but in general the system is geared toward continuous
deployment. Keep new features hidden behind runtime flags, and fix bugs by pushing fixes to dev,
then staging, then production, rather than trying to isolate patches and backport them to whatever
snapshot is running in production.

### Interaction with VCS

Though the shipping version of a game will come from the runtime database of resources, teams will
likely still want to keep some or all game data in traditional version control systems. Depending
on the type of resource, the data will generally flow in different directions.

Source code will definitely live in a version control system, and build tools will be provided for
uploading compiled JavaScript code (compiled from TypeScript or just processed by Babel, whatever
the dev workflow happens to be) into the resource system. For most games, source code would never
be edited "in" the resource system and pulled back out into VCS, so we won't support that, at least
initially. As a result, source code resources will probably not be pushed via the resource system
from a developer's branch workspace into the dev workspace. Rather when a developer has committed
their code they may just push their built code to the dev workspace at that time using the same
mechanism they use to push in-development code to their branch workspace (because it will be much
easier).

Media (images, 3D models, audio files, etc.) will also likely live in VCS and only ever be
"uploaded" to the resource system. However, an artist may choose to both commit updated media to
VCS _and_ push it to the dev workspace via the workspace browser because they will not be set up to
push resources from VCS to workspaces, so this will enable them to get their work into the dev
workspace directly rather than committing to VCS and requesting that a programmer push it to dev.

Configuration data will generally flow from the resource system to VCS, because edits to the
configuration data happen in "resource system aware" editors, which change the data directly in the
resource database, and there is no natural external "source of truth" for that data. Thus tools
will be provided to allow one to download JSON files for all configuration resources into the
game's VCS source tree as part of the release process. So when the dev workspace was being
snapshotted for a staging release, the current state of the configuration could be downloaded to
VCS and committed as part of that process. In general config snapshots in VCS would not be uploaded
to the resource server, but they could be used when one is creating an entirely new installation,
or if one was running a local installation that was isolated from the cloud-based resource
database.

## Resource runtime

A resource management service will be provided for the game client and server, and resource aware
editors. The game client will generally simply download resources by ID and listen for changes to
them so that they may be hot reloaded on change. We will probably initially not load source code
through the resource system, but eventually it too will be stored as resources and hot reloaded on
change, which will necessitate loading resources by path as well as by ID. This will likely include
a cache and/or some sort of manifest or preloading system so that the client can quickly load the
bulk of the code that is needed to get into an initial experience.

The resource management service will take care of merging multiple workspaces into a single unified
logical workspace in the case where a client or server is running against a branch workspace. For
the client and server the API will be fairly straightforward: give an ID or path, get back a
reactive value representing the data or URL for the underlying resource. The value changes when the
resource changes. In the case of resource editors, the API will include directory services
(browsing the resource directory, creating new directories, renaming and moving resources and
directories) as well as a way to save and/or upload resource data.

Most of the resource data maps nicely onto distributed objects, and most of the functionality falls
out of modeling it on top of the distributed object system, but there will also be a custom
resource service (using tfw.rpc) which handles things like lookup by path which can not be done
efficiently purely from a client-only view of the distributed data model.

## Media storage

The production resource system will be integrated with AWS S3 such that media resource data will be
uploaded into an S3 file named via the hash of the resource data. In general multiple resources
should not refer to the same hash, but it could happen, so we will likely garbage collect the
contents of the S3 bucket periodically by scanning all resources in all workspaces to see which
hashes are used and then deleting those which are no longer referenced by any active workspace or
snapshot (snapshots will presumably be either deleted or archived after some time period).
