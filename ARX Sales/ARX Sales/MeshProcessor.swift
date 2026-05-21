import ARKit
import simd

// MARK: - Mesh Processor
// Analyzes ARMeshAnchor geometry from a LiDAR scan and classifies
// triangles into roof faces and wall faces based on surface normals.

final class MeshProcessor {

    // Thresholds
    private let roofNormalYMin:  Float = 0.50   // normal.y > this → roof
    private let groundNormalYMax: Float = -0.50 // normal.y < this → ground (ignore)
    private let clusterAngleDeg: Double = 18.0  // faces within this angle = same cluster
    private let minFaceAreaSqFt: Double = 2.0   // ignore tiny fragments

    // MARK: - Main Entry Point

    func process(anchors: [ARMeshAnchor], scanType: ScanType) -> ScanResult {
        var allTriangles: [Triangle] = []

        for anchor in anchors {
            let triangles = extractTriangles(from: anchor)
            allTriangles.append(contentsOf: triangles)
        }

        let roofTriangles  = allTriangles.filter { $0.faceClass == .roof }
        let wallTriangles  = allTriangles.filter { $0.faceClass == .wall }

        let roofFaces = cluster(roofTriangles, targetClass: .roof)
        let wallFaces = clusterWalls(wallTriangles)

        return ScanResult(
            roofFaces: roofFaces,
            wallFaces: wallFaces,
            usedLiDAR: true
        )
    }

    // MARK: - Triangle Extraction

    private struct Triangle {
        let v0, v1, v2: SIMD3<Float>   // world-space
        let normal: SIMD3<Float>        // world-space, normalized
        let areaSqM: Float
        let faceClass: FaceClass
        let centroid: SIMD3<Float>
    }

    private func extractTriangles(from anchor: ARMeshAnchor) -> [Triangle] {
        let geometry = anchor.geometry
        let transform = anchor.transform
        var result: [Triangle] = []

        let vertexBuffer    = geometry.vertices.buffer.contents()
        let vertexStride    = geometry.vertices.stride
        let vertexOffset    = geometry.vertices.offset

        let faceBuffer      = geometry.faces.buffer.contents()
        let faceCount       = geometry.faces.count
        let bytesPerIndex   = geometry.faces.bytesPerIndex

        for i in 0..<faceCount {
            // Read 3 vertex indices
            let idx0 = readIndex(faceBuffer, at: i * 3 + 0, bytes: bytesPerIndex)
            let idx1 = readIndex(faceBuffer, at: i * 3 + 1, bytes: bytesPerIndex)
            let idx2 = readIndex(faceBuffer, at: i * 3 + 2, bytes: bytesPerIndex)

            // Read local vertices
            let lv0 = readVertex(vertexBuffer, at: Int(idx0), stride: vertexStride, offset: vertexOffset)
            let lv1 = readVertex(vertexBuffer, at: Int(idx1), stride: vertexStride, offset: vertexOffset)
            let lv2 = readVertex(vertexBuffer, at: Int(idx2), stride: vertexStride, offset: vertexOffset)

            // Transform to world space
            let wv0 = transform * SIMD4<Float>(lv0, 1)
            let wv1 = transform * SIMD4<Float>(lv1, 1)
            let wv2 = transform * SIMD4<Float>(lv2, 1)

            let p0 = SIMD3<Float>(wv0.x, wv0.y, wv0.z)
            let p1 = SIMD3<Float>(wv1.x, wv1.y, wv1.z)
            let p2 = SIMD3<Float>(wv2.x, wv2.y, wv2.z)

            // Compute face normal from geometry
            let edge1 = p1 - p0
            let edge2 = p2 - p0
            let crossProd = cross(edge1, edge2)
            let len = length(crossProd)
            guard len > 1e-6 else { continue }
            let normal = crossProd / len

            // Triangle area (m²)
            let areaSqM = len * 0.5

            // Classify
            let fc = classify(normal: normal)
            guard fc != .ground, fc != .other else { continue }

            let centroid = (p0 + p1 + p2) / 3.0

            result.append(Triangle(
                v0: p0, v1: p1, v2: p2,
                normal: normal,
                areaSqM: areaSqM,
                faceClass: fc,
                centroid: centroid
            ))
        }
        return result
    }

    // MARK: - Classification

    private func classify(normal: SIMD3<Float>) -> FaceClass {
        if normal.y > roofNormalYMin  { return .roof }
        if normal.y < groundNormalYMax { return .ground }
        if abs(normal.y) < 0.35       { return .wall }
        return .other
    }

    // MARK: - Clustering
    // Groups triangles with similar normals + spatial proximity into faces

    private func cluster(_ triangles: [Triangle], targetClass: FaceClass) -> [RoofFace] {
        guard !triangles.isEmpty else { return [] }

        var remaining = triangles
        var clusters: [[Triangle]] = []
        let cosThreshold = Float(cos(clusterAngleDeg * .pi / 180))

        while !remaining.isEmpty {
            var cluster = [remaining.removeFirst()]
            let seedNormal = cluster[0].normal

            var i = 0
            while i < remaining.count {
                let t = remaining[i]
                // Same normal direction?
                let dot = abs(simd_dot(t.normal, seedNormal))
                // Spatially connected (within 3 meters)?
                let dist = simd_distance(t.centroid, cluster[0].centroid)
                if dot > cosThreshold && dist < 8.0 {
                    cluster.append(remaining.remove(at: i))
                } else {
                    i += 1
                }
            }
            clusters.append(cluster)
        }

        // Convert clusters to RoofFace / WallFace
        var faces: [RoofFace] = []
        for cluster in clusters {
            let totalAreaSqM = cluster.reduce(0.0) { $0 + Double($1.areaSqM) }
            let totalAreaSqFt = totalAreaSqM * 10.7639

            guard totalAreaSqFt >= minFaceAreaSqFt else { continue }

            // Average normal
            let avgNormal = cluster.reduce(SIMD3<Float>.zero) { $0 + $1.normal } / Float(cluster.count)
            let norm = length(avgNormal) > 0 ? avgNormal / length(avgNormal) : avgNormal

            // Collect all vertices for this face
            var verts: [SIMD3<Float>] = []
            for t in cluster { verts.append(contentsOf: [t.v0, t.v1, t.v2]) }

            if targetClass == .roof {
                faces.append(RoofFace(vertices: verts, normal: norm, areaSqFt: totalAreaSqFt))
            }
            // Wall faces reuse RoofFace slot via the same init but we handle separately below
        }
        return faces
    }

    private func clusterWalls(_ triangles: [Triangle]) -> [WallFace] {
        guard !triangles.isEmpty else { return [] }

        var remaining = triangles
        var clusters: [[Triangle]] = []
        let cosThreshold = Float(cos(clusterAngleDeg * .pi / 180))

        while !remaining.isEmpty {
            var cluster = [remaining.removeFirst()]
            let seedNormal = cluster[0].normal

            var i = 0
            while i < remaining.count {
                let t = remaining[i]
                let dot = abs(simd_dot(t.normal, seedNormal))
                let dist = simd_distance(t.centroid, cluster[0].centroid)
                if dot > cosThreshold && dist < 12.0 {
                    cluster.append(remaining.remove(at: i))
                } else {
                    i += 1
                }
            }
            clusters.append(cluster)
        }

        var faces: [WallFace] = []
        for cluster in clusters {
            let totalAreaSqFt = cluster.reduce(0.0) { $0 + Double($1.areaSqM) } * 10.7639
            guard totalAreaSqFt >= minFaceAreaSqFt else { continue }

            let avgNormal = cluster.reduce(SIMD3<Float>.zero) { $0 + $1.normal } / Float(cluster.count)
            let norm = length(avgNormal) > 0 ? avgNormal / length(avgNormal) : avgNormal

            var verts: [SIMD3<Float>] = []
            for t in cluster { verts.append(contentsOf: [t.v0, t.v1, t.v2]) }

            faces.append(WallFace(vertices: verts, normal: norm, areaSqFt: totalAreaSqFt))
        }
        return faces
    }

    // MARK: - Full Process with Wall Separation

    func processFull(anchors: [ARMeshAnchor]) -> ScanResult {
        var allTriangles: [Triangle] = []
        for anchor in anchors {
            allTriangles.append(contentsOf: extractTriangles(from: anchor))
        }

        let roofTris = allTriangles.filter { $0.faceClass == .roof }
        let wallTris = allTriangles.filter { $0.faceClass == .wall }

        let roofFaces = cluster(roofTris, targetClass: .roof)
        let wallFaces = clusterWalls(wallTris)

        return ScanResult(roofFaces: roofFaces, wallFaces: wallFaces, usedLiDAR: true)
    }

    // MARK: - Buffer Helpers

    private func readIndex(_ buffer: UnsafeMutableRawPointer, at position: Int, bytes: Int) -> UInt32 {
        if bytes == 2 {
            return UInt32(buffer.advanced(by: position * 2).assumingMemoryBound(to: UInt16.self).pointee)
        } else {
            return buffer.advanced(by: position * 4).assumingMemoryBound(to: UInt32.self).pointee
        }
    }

    private func readVertex(_ buffer: UnsafeMutableRawPointer, at index: Int, stride: Int, offset: Int) -> SIMD3<Float> {
        let ptr = buffer.advanced(by: offset + index * stride).assumingMemoryBound(to: SIMD3<Float>.self)
        return ptr.pointee
    }
}
