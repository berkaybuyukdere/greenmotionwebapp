import { addDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { ref, uploadBytesResumable } from 'firebase/storage';
import { categoryLabel, mimeFromName } from './fileLibraryHelpers';

export function storagePathForFileLibrary(franchiseId, parentId, docId, fileName) {
    const fid = String(franchiseId || 'CH').trim().toUpperCase();
    const safeParent = parentId || '_root';
    const safeName = String(fileName || 'file').replace(/[/\\#?]/g, '_');
    return `franchises/${fid}/fileLibrary/${safeParent}/${docId}_${safeName}`;
}

/**
 * Upload a File/Blob into franchise fileLibrary (Firestore + Storage).
 * @param {object} opts
 * @param {import('firebase/firestore').CollectionReference} opts.collRef
 * @param {import('firebase/storage').FirebaseStorage} opts.storage
 * @param {function} [opts.onProgress] - (0-100) => void
 */
export async function uploadBlobToFileLibrary({
    collRef,
    storage,
    franchiseId,
    parentId = '',
    file,
    fileName,
    category = 'other',
    note = '',
    user,
    uploaderName,
    onProgress,
}) {
    const fid = String(franchiseId || 'CH').trim().toUpperCase();
    const name = String(fileName || file?.name || 'document').trim();
    const mimeType = file?.type || mimeFromName(name);
    const sizeBytes = file?.size ?? 0;

    const docRef = await addDoc(collRef, {
        franchiseId: fid,
        type: 'file',
        parentId: parentId || '',
        name,
        fileName: name,
        category,
        mimeType,
        sizeBytes,
        note: String(note || '').trim(),
        storagePath: '',
        uploadedByUid: user?.uid || null,
        uploadedByName: uploaderName || 'User',
        uploadedByEmail: user?.email || '',
        searchBlob: `${name} ${categoryLabel(category)} ${uploaderName || ''} ${note || ''}`.toLowerCase(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });

    const path = storagePathForFileLibrary(fid, parentId, docRef.id, name);
    const storageRef = ref(storage, path);

    await new Promise((resolve, reject) => {
        const task = uploadBytesResumable(storageRef, file, { contentType: mimeType });
        task.on(
            'state_changed',
            (snap) => {
                if (onProgress && snap.totalBytes) {
                    onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
                }
            },
            reject,
            resolve
        );
    });

    await updateDoc(docRef, {
        storagePath: path,
        updatedAt: serverTimestamp(),
    });

    return { id: docRef.id, storagePath: path };
}
