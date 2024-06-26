import * as THREE from 'three';
import { SplatBuffer } from '../SplatBuffer.js';
import { SplatBufferGenerator } from '../SplatBufferGenerator.js';
import { SplatParser } from './SplatParser.js';
import { fetchWithProgress, delayedExecute, nativePromiseWithExtractedComponents } from '../../Util.js';
import { LoaderStatus } from '../LoaderStatus.js';
import { Constants } from '../../Constants.js';

export class SplatLoader {

    static loadFromURL(fileName, onProgress, progressiveLoad, onStreamedSectionProgress, minimumAlpha, compressionLevel,
                       optimizeSplatData, sectionSize, sceneCenter, blockSize, bucketSize) {

        const splatDataOffsetBytes = SplatBuffer.HeaderSizeBytes + SplatBuffer.SectionHeaderSizeBytes;
        const progressiveLoadSectionSizeBytes = Constants.ProgressiveLoadSectionSize;
        const sectionCount = 1;

        let progressiveLoadBufferIn;
        let progressiveLoadBufferOut;
        let progressiveLoadSplatBuffer;
        let maxSplatCount = 0;
        let splatCount = 0;

        const progressiveLoadPromise = nativePromiseWithExtractedComponents();

        let numBytesStreamed = 0;
        let numBytesLoaded = 0;
        let chunks = [];

        const localOnProgress = (percent, percentStr, chunk, fileSize) => {
            const loadComplete = percent >= 100;
            if (!fileSize) progressiveLoad = false;
            if (progressiveLoad) {
                if (!progressiveLoadBufferIn) {
                    maxSplatCount = fileSize / SplatParser.RowSizeBytes;
                    progressiveLoadBufferIn = new ArrayBuffer(fileSize);
                    const bytesPerSplat = SplatBuffer.CompressionLevels[0].SphericalHarmonicsDegrees[0].BytesPerSplat;
                    const splatBufferSizeBytes = splatDataOffsetBytes + bytesPerSplat * maxSplatCount;
                    progressiveLoadBufferOut = new ArrayBuffer(splatBufferSizeBytes);
                    SplatBuffer.writeHeaderToBuffer({
                        versionMajor: SplatBuffer.CurrentMajorVersion,
                        versionMinor: SplatBuffer.CurrentMinorVersion,
                        maxSectionCount: sectionCount,
                        sectionCount: sectionCount,
                        maxSplatCount: maxSplatCount,
                        splatCount: splatCount,
                        compressionLevel: 0,
                        sceneCenter: new THREE.Vector3()
                    }, progressiveLoadBufferOut);
                }

                if (chunk) {
                    chunks.push(chunk);
                    new Uint8Array(progressiveLoadBufferIn, numBytesLoaded, chunk.byteLength).set(new Uint8Array(chunk));
                    numBytesLoaded += chunk.byteLength;

                    const bytesLoadedSinceLastSection = numBytesLoaded - numBytesStreamed;
                    if (bytesLoadedSinceLastSection > progressiveLoadSectionSizeBytes || loadComplete) {
                        const bytesToUpdate = loadComplete ? bytesLoadedSinceLastSection : progressiveLoadSectionSizeBytes;
                        const addedSplatCount = bytesToUpdate / SplatParser.RowSizeBytes;
                        const newSplatCount = splatCount + addedSplatCount;
                        SplatParser.parseToUncompressedSplatBufferSection(splatCount, newSplatCount - 1, progressiveLoadBufferIn, 0,
                                                                          progressiveLoadBufferOut, splatDataOffsetBytes);
                        splatCount = newSplatCount;
                        if (!progressiveLoadSplatBuffer) {
                            SplatBuffer.writeSectionHeaderToBuffer({
                                maxSplatCount: maxSplatCount,
                                splatCount: splatCount,
                                bucketSize: 0,
                                bucketCount: 0,
                                bucketBlockSize: 0,
                                compressionScaleRange: 0,
                                storageSizeBytes: 0,
                                fullBucketCount: 0,
                                partiallyFilledBucketCount: 0
                            }, 0, progressiveLoadBufferOut, SplatBuffer.HeaderSizeBytes);
                            progressiveLoadSplatBuffer = new SplatBuffer(progressiveLoadBufferOut, false);
                        }
                        progressiveLoadSplatBuffer.updateLoadedCounts(1, splatCount);
                        onStreamedSectionProgress(progressiveLoadSplatBuffer, loadComplete);
                        numBytesStreamed += progressiveLoadSectionSizeBytes;
                    }
                }
                if (loadComplete) {
                    progressiveLoadPromise.resolve(progressiveLoadSplatBuffer);
                }
            }
            if (onProgress) onProgress(percent, percentStr, LoaderStatus.Downloading);
            return progressiveLoad;
        };

        return fetchWithProgress(fileName, localOnProgress, true).then((fullBuffer) => {
            if (onProgress) onProgress(0, '0%', LoaderStatus.Processing);
            const loadPromise = progressiveLoad ? progressiveLoadPromise.promise :
                SplatLoader.loadFromFileData(fullBuffer, minimumAlpha, compressionLevel, optimizeSplatData,
                                             sectionSize, sceneCenter, blockSize, bucketSize);
            return loadPromise.then((splatBuffer) => {
                if (onProgress) onProgress(100, '100%', LoaderStatus.Done);
                return splatBuffer;
            });
        });
    }

    static loadFromFileData(splatFileData, minimumAlpha, compressionLevel, optimizeSplatData,
                            sectionSize, sceneCenter, blockSize, bucketSize) {
        return delayedExecute(() => {
            const splatArray = SplatParser.parseStandardSplatToUncompressedSplatArray(splatFileData);
            if (optimizeSplatData) {
                const splatBufferGenerator = SplatBufferGenerator.getStandardGenerator(minimumAlpha, compressionLevel,
                                                                                       sectionSize, sceneCenter, blockSize,
                                                                                       bucketSize);
                return splatBufferGenerator.generateFromUncompressedSplatArray(splatArray);
            } else {
                return SplatBuffer.generateFromUncompressedSplatArrays([splatArray], minimumAlpha, 0, new THREE.Vector3());
            }
        });
    }

}
