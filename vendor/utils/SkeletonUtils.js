import { Matrix4, Quaternion, Vector3 } from 'three';

// Deep-clone an Object3D hierarchy containing SkinnedMeshes, rebinding each
// clone's skeleton to the CLONED bones instead of the source ones.
//
// Object3D.clone() copies the mesh but leaves skeleton.bones pointing at the
// original armature, so every clone would deform with — and be posed by — the
// first instance's mixer. Autochess fields several copies of the same fighter
// at once, so real cloning is mandatory.
//
// Ported from three/examples/jsm/utils/SkeletonUtils.js (r170) to keep the
// project's no-build, vendored-dependency setup.
function clone(source) {
	const sourceLookup = new Map();
	const cloneLookup = new Map();

	const cloned = source.clone();

	parallelTraverse(source, cloned, function (sourceNode, clonedNode) {
		sourceLookup.set(clonedNode, sourceNode);
		cloneLookup.set(sourceNode, clonedNode);
	});

	cloned.traverse(function (node) {
		if (!node.isSkinnedMesh) return;

		const clonedMesh = node;
		const sourceMesh = sourceLookup.get(node);
		const sourceBones = sourceMesh.skeleton.bones;

		clonedMesh.skeleton = sourceMesh.skeleton.clone();
		clonedMesh.bindMatrix.copy(sourceMesh.bindMatrix);

		clonedMesh.skeleton.bones = sourceBones.map(function (bone) {
			return cloneLookup.get(bone);
		});

		clonedMesh.bind(clonedMesh.skeleton, clonedMesh.bindMatrix);
	});

	return cloned;
}

function parallelTraverse(a, b, callback) {
	callback(a, b);

	for (let i = 0; i < a.children.length; i++) {
		parallelTraverse(a.children[i], b.children[i], callback);
	}
}

export { clone };
