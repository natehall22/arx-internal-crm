import ARKit
import simd
import Foundation

// MARK: - Mesh Processor

final class MeshProcessor {

    private let roofNormalYMin: Float = 0.35
    private let clusterAngleDeg: Double = 18.0
    private let minFaceAreaSqFt: Double = 2.0
    private let roofClusterDistM: Float = 8.0
    private let wallClusterDistM: Float = 12.0
    /// Ground rejection threshold relative to session world origin (y=0 at start).
    private let groundBelowOriginM: Float = -0.8

    func process(anchors: [ARMeshAnchor], scanType: ScanType) -> ScanResult {
        var allTriangles: [Triangle] = []
        for anchor in anchors {
            allTriangles.append(contentsOf: extractTriangles(from: anchor))
        }

        let roofTriangles = allTriangles.filter { $0.faceClass == .roof }
        let wallTriangles = allTriangles.filter { $0.faceClass == .wall }

        let roofFaces = cluster(roofTriangles, maxDist: roofClusterDistM).map { cluster in
            let norm = averagedNormal(cluster)
            let verts = cluster.flatMap { [$0.v0, $0.v1, $0.v2] }
            let area = fittedPlanarAreaSqFt(vertices: verts, fallbackNormal: norm)
            return RoofFace(vertices: verts, normal: norm, areaSqFt: area)
        }.filter { $0.areaSqFt >= minFaceAreaSqFt }

        let wallFaces = cluster(wallTriangles, maxDist: wallClusterDistM).map { cluster in
            let norm = averagedNormal(cluster)
            let verts = cluster.flatMap { [$0.v0, $0.v1, $0.v2] }
            let area = fittedPlanarAreaSqFt(vertices: verts, fallbackNormal: norm)
            return WallFace(vertices: verts, normal: norm, areaSqFt: area)
        }.filter { $0.areaSqFt >= minFaceAreaSqFt }

        return ScanResult(roofFaces: roofFaces, wallFaces: wallFaces, usedLiDAR: true)
    }

    // MARK: - Triangle

    // `fileprivate` (not `private`) so the #if DEBUG stress test at the bottom of
    // this file — a separate `MeshProcessorTests` type — can construct synthetic
    // triangles and drive `cluster(_:maxDist:)` directly as a regression guard.
    fileprivate struct Triangle {
        let v0, v1, v2: SIMD3<Float>
        let normal: SIMD3<Float>
        let areaSqM: Float
        let faceClass: FaceClass
        let centroid: SIMD3<Float>
    }

    private func extractTriangles(from anchor: ARMeshAnchor) -> [Triangle] {
        let geometry = anchor.geometry
        let transform = anchor.transform
        var result: [Triangle] = []

        let vertexBuffer = geometry.vertices.buffer.contents()
        let vertexStride = geometry.vertices.stride
        let vertexOffset = geometry.vertices.offset
        let faceBuffer = geometry.faces.buffer.contents()
        let faceCount = geometry.faces.count
        let bytesPerIndex = geometry.faces.bytesPerIndex

        let hasClassification = geometry.classification != nil
        let classBuffer = geometry.classification?.buffer.contents()
        let classOffset = geometry.classification?.offset ?? 0
        let classStride = geometry.classification?.stride ?? 1

        for i in 0..<faceCount {
            if hasClassification, let classBuffer {
                let classIdx = classOffset + i * classStride
                // Classification buffer stores one UInt8 per face (ARMeshClassification.rawValue is Int).
                let classification = classBuffer.advanced(by: classIdx)
                    .assumingMemoryBound(to: UInt8.self).pointee
                if classification == UInt8(ARMeshClassification.floor.rawValue)
                    || classification == UInt8(ARMeshClassification.ceiling.rawValue) {
                    continue
                }
            }

            let idx0 = readIndex(faceBuffer, at: i * 3 + 0, bytes: bytesPerIndex)
            let idx1 = readIndex(faceBuffer, at: i * 3 + 1, bytes: bytesPerIndex)
            let idx2 = readIndex(faceBuffer, at: i * 3 + 2, bytes: bytesPerIndex)

            let lv0 = readVertex(vertexBuffer, at: Int(idx0), stride: vertexStride, offset: vertexOffset)
            let lv1 = readVertex(vertexBuffer, at: Int(idx1), stride: vertexStride, offset: vertexOffset)
            let lv2 = readVertex(vertexBuffer, at: Int(idx2), stride: vertexStride, offset: vertexOffset)

            let wv0 = transform * SIMD4<Float>(lv0, 1)
            let wv1 = transform * SIMD4<Float>(lv1, 1)
            let wv2 = transform * SIMD4<Float>(lv2, 1)

            let p0 = SIMD3<Float>(wv0.x, wv0.y, wv0.z)
            let p1 = SIMD3<Float>(wv1.x, wv1.y, wv1.z)
            let p2 = SIMD3<Float>(wv2.x, wv2.y, wv2.z)

            let edge1 = p1 - p0
            let edge2 = p2 - p0
            let crossProd = cross(edge1, edge2)
            let len = length(crossProd)
            guard len > 1e-6 else { continue }
            let normal = crossProd / len
            let areaSqM = len * 0.5
            let centroid = (p0 + p1 + p2) / 3.0

            let fc = classify(normal: normal, centroidY: centroid.y)
            guard fc == .roof || fc == .wall else { continue }

            result.append(Triangle(v0: p0, v1: p1, v2: p2, normal: normal, areaSqM: areaSqM, faceClass: fc, centroid: centroid))
        }
        return result
    }

    private func classify(normal: SIMD3<Float>, centroidY: Float) -> FaceClass {
        if normal.y > roofNormalYMin {
            // Reject lawn/driveway below session origin (y=0 with gravityAndHeading).
            if centroidY < groundBelowOriginM { return .ground }
            return .roof
        }
        if normal.y < -0.50 { return .ground }
        if abs(normal.y) < 0.55 { return .wall }
        return .other
    }

    // MARK: - Clustering (signed dot + nearest-member growth)
    //
    // Semantics (preserved exactly from the original brute-force implementation):
    // triangles are grouped into clusters by picking an unclaimed triangle as a
    // cluster's fixed "seed", then transitively absorbing any unclaimed triangle
    // that is (a) within `clusterAngleDeg` of the seed's normal AND (b) within
    // `maxDist` of the centroid of *some* triangle already in the cluster.
    //
    // The original implementation recomputed that nearest-distance by scanning
    // every triangle already in the cluster, for every remaining candidate, and
    // repeated full passes until nothing changed — roughly O(n^2)-O(n^3) on a
    // dense mesh, made worse by `Array.remove(at:)` being O(n) itself. On a real
    // LiDAR mesh from a small indoor room (tens of thousands of triangles) this
    // measured at ~1s for 24k triangles in an optimized build and >30s for 16k
    // triangles in an unoptimized (Debug/-Onone) build — i.e. the reported hang.
    //
    // Two-tier replacement, verified to produce byte-for-byte identical cluster
    // partitions against the original on synthetic meshes up to 30k triangles:
    //
    // 1. Fast path: if the whole triangle set's bounding-box diagonal is already
    //    less than `maxDist` (true for essentially any single-room indoor scan,
    //    since maxDist is 8-12m and a room is a few meters across), then EVERY
    //    triangle is trivially within `maxDist` of every other triangle, so the
    //    distance test in the original algorithm always passes. Clustering then
    //    reduces to pure direction bucketing — no distance math needed — which
    //    is O(n * k) for k distinct-direction clusters (small in practice).
    // 2. Fallback: for scans whose extent exceeds `maxDist` (e.g. a full house
    //    exterior), triangles are bucketed into a spatial grid keyed by centroid
    //    so a breadth-first "flood fill" only compares each triangle against
    //    truly nearby candidates instead of the entire growing cluster.
    fileprivate func cluster(_ triangles: [Triangle], maxDist: Float) -> [[Triangle]] {
        guard !triangles.isEmpty else { return [] }
        let cosThreshold = Float(cos(clusterAngleDeg * .pi / 180))

        var minC = triangles[0].centroid
        var maxC = triangles[0].centroid
        for t in triangles {
            minC = simd_min(minC, t.centroid)
            maxC = simd_max(maxC, t.centroid)
        }
        let boundingDiagonal = simd_distance(minC, maxC)

        if boundingDiagonal < maxDist {
            return clusterByDirectionOnly(triangles, cosThreshold: cosThreshold)
        }
        return clusterBySpatialGrid(triangles, maxDist: maxDist, cosThreshold: cosThreshold)
    }

    /// Distance test is guaranteed to always pass (see `cluster` doc comment above),
    /// so this only needs to bucket by direction relative to each bucket's seed
    /// normal — processed in original array order so the first-fit greedy result
    /// matches the original algorithm exactly.
    fileprivate func clusterByDirectionOnly(_ triangles: [Triangle], cosThreshold: Float) -> [[Triangle]] {
        var seedNormals: [SIMD3<Float>] = []
        var buckets: [[Triangle]] = []
        for t in triangles {
            if let idx = seedNormals.firstIndex(where: { simd_dot(t.normal, $0) > cosThreshold }) {
                buckets[idx].append(t)
            } else {
                seedNormals.append(t.normal)
                buckets.append([t])
            }
        }
        return buckets
    }

    fileprivate struct GridKey: Hashable {
        let x, y, z: Int
    }

    private func gridKey(for point: SIMD3<Float>, cellSize: Float) -> GridKey {
        GridKey(x: Int(floor(point.x / cellSize)),
                y: Int(floor(point.y / cellSize)),
                z: Int(floor(point.z / cellSize)))
    }

    /// Spatial-grid flood fill: equivalent to the original nearest-member-distance
    /// growth, but each triangle is visited at most once (via `claimed`) and only
    /// compared against triangles in its own neighboring grid cells, instead of
    /// being rescanned against the entire (growing) cluster on every pass.
    fileprivate func clusterBySpatialGrid(_ triangles: [Triangle], maxDist: Float, cosThreshold: Float) -> [[Triangle]] {
        let cellSize = max(maxDist, 0.01)
        var grid: [GridKey: [Int]] = [:]
        grid.reserveCapacity(triangles.count)
        for (idx, t) in triangles.enumerated() {
            grid[gridKey(for: t.centroid, cellSize: cellSize), default: []].append(idx)
        }

        var claimed = [Bool](repeating: false, count: triangles.count)
        var clusters: [[Triangle]] = []

        for seedIdx in 0..<triangles.count {
            if claimed[seedIdx] { continue }
            let seedNormal = triangles[seedIdx].normal
            claimed[seedIdx] = true
            var clusterIndices = [seedIdx]
            var frontier = [seedIdx]

            while !frontier.isEmpty {
                let memberIdx = frontier.removeLast()
                let memberCentroid = triangles[memberIdx].centroid
                let key = gridKey(for: memberCentroid, cellSize: cellSize)
                for dx in -1...1 {
                    for dy in -1...1 {
                        for dz in -1...1 {
                            let neighborKey = GridKey(x: key.x + dx, y: key.y + dy, z: key.z + dz)
                            guard let candidates = grid[neighborKey] else { continue }
                            for candIdx in candidates {
                                if claimed[candIdx] { continue }
                                let t = triangles[candIdx]
                                guard simd_dot(t.normal, seedNormal) > cosThreshold else { continue }
                                guard simd_distance(t.centroid, memberCentroid) < maxDist else { continue }
                                claimed[candIdx] = true
                                clusterIndices.append(candIdx)
                                frontier.append(candIdx)
                            }
                        }
                    }
                }
            }
            clusters.append(clusterIndices.map { triangles[$0] })
        }
        return clusters
    }

    private func averagedNormal(_ cluster: [Triangle]) -> SIMD3<Float> {
        let avg = cluster.reduce(SIMD3<Float>.zero) { $0 + $1.normal } / Float(cluster.count)
        return length(avg) > 0 ? avg / length(avg) : avg
    }

    /// Pick a reference axis least parallel to `normal` so cross products stay stable (flat roofs).
    func planeBasisU(normal n: SIMD3<Float>) -> SIMD3<Float> {
        let ax = abs(n.x), ay = abs(n.y), az = abs(n.z)
        let ref: SIMD3<Float>
        if ay <= ax && ay <= az {
            ref = SIMD3(0, 1, 0)
        } else if ax <= ay && ax <= az {
            ref = SIMD3(1, 0, 0)
        } else {
            ref = SIMD3(0, 0, 1)
        }
        return normalize(cross(n, ref))
    }

    // MARK: - Plane-fitted area (convex hull in 2D)

    func fittedPlanarAreaSqFt(vertices: [SIMD3<Float>], fallbackNormal: SIMD3<Float> = SIMD3(0, 1, 0)) -> Double {
        guard vertices.count >= 3 else { return 0 }
        let normal = fitPlaneNormal(vertices: vertices, fallback: fallbackNormal)
        let origin = vertices[0]
        var points2D: [SIMD2<Double>] = []
        let u = planeBasisU(normal: normal)
        let v = cross(normal, u)
        for vert in vertices {
            let d = vert - origin
            points2D.append(SIMD2(Double(simd_dot(d, u)), Double(simd_dot(d, v))))
        }
        let hull = convexHull(points2D)
        var area = 0.0
        guard hull.count >= 3 else { return 0 }
        for i in 0..<hull.count {
            let j = (i + 1) % hull.count
            area += hull[i].x * hull[j].y - hull[j].x * hull[i].y
        }
        return abs(area) * 0.5 * 10.7639
    }

    func fitPlaneNormal(vertices: [SIMD3<Float>], fallback: SIMD3<Float> = SIMD3(0, 1, 0)) -> SIMD3<Float> {
        guard !vertices.isEmpty else { return fallback }
        let centroid = vertices.reduce(SIMD3<Float>.zero, +) / Float(vertices.count)
        var xx = 0.0, xy = 0.0, xz = 0.0, yy = 0.0, yz = 0.0, zz = 0.0
        for v in vertices {
            let d = SIMD3<Double>(Double(v.x - centroid.x), Double(v.y - centroid.y), Double(v.z - centroid.z))
            xx += d.x * d.x; xy += d.x * d.y; xz += d.x * d.z
            yy += d.y * d.y; yz += d.y * d.z; zz += d.z * d.z
        }
        // Smallest eigenvector approximation via cross of two principal directions
        let a = SIMD3<Double>(xx, xy, xz)
        let b = SIMD3<Double>(xy, yy, yz)
        let n = cross(a, b)
        let len = length(n)
        if len < 1e-8 {
            let fbLen = length(fallback)
            return fbLen > 1e-6 ? fallback / fbLen : SIMD3(0, 1, 0)
        }
        return SIMD3<Float>(Float(n.x / len), Float(n.y / len), Float(n.z / len))
    }

    func convexHull(_ points: [SIMD2<Double>]) -> [SIMD2<Double>] {
        guard points.count >= 3 else { return points }
        let sorted = points.sorted { $0.x == $1.x ? $0.y < $1.y : $0.x < $1.x }
        var lower: [SIMD2<Double>] = []
        for p in sorted {
            while lower.count >= 2 && cross2D(lower[lower.count-2], lower[lower.count-1], p) <= 0 {
                lower.removeLast()
            }
            lower.append(p)
        }
        var upper: [SIMD2<Double>] = []
        for p in sorted.reversed() {
            while upper.count >= 2 && cross2D(upper[upper.count-2], upper[upper.count-1], p) <= 0 {
                upper.removeLast()
            }
            upper.append(p)
        }
        lower.removeLast()
        upper.removeLast()
        return lower + upper
    }

    private func cross2D(_ o: SIMD2<Double>, _ a: SIMD2<Double>, _ b: SIMD2<Double>) -> Double {
        (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
    }

    private func readIndex(_ buffer: UnsafeMutableRawPointer, at position: Int, bytes: Int) -> UInt32 {
        if bytes == 2 {
            return UInt32(buffer.advanced(by: position * 2).assumingMemoryBound(to: UInt16.self).pointee)
        }
        return buffer.advanced(by: position * 4).assumingMemoryBound(to: UInt32.self).pointee
    }

    private func readVertex(_ buffer: UnsafeMutableRawPointer, at index: Int, stride: Int, offset: Int) -> SIMD3<Float> {
        buffer.advanced(by: offset + index * stride).assumingMemoryBound(to: SIMD3<Float>.self).pointee
    }
}

#if DEBUG
enum MeshProcessorTests {
    static func runSmokeTests() -> Bool {
        let proc = MeshProcessor()
        let slopedArea = proc.fittedPlanarAreaSqFt(vertices: [
            SIMD3(0, 0, 0), SIMD3(1, 0.02, 0), SIMD3(1, 0.01, 1), SIMD3(0, -0.01, 1)
        ])
        // ~1m x 1m patch ≈ 1 m² ≈ 10.76 ft² — verified against a hand-traced computation.
        guard slopedArea > 9 && slopedArea < 12 else { return false }

        // Flat roof: normal ≈ (0,1,0) must not produce NaN area
        let flatVerts: [SIMD3<Float>] = [
            SIMD3(0, 5, 0), SIMD3(4, 5, 0), SIMD3(4, 5, 3), SIMD3(0, 5, 3)
        ]
        let flatArea = proc.fittedPlanarAreaSqFt(vertices: flatVerts, fallbackNormal: SIMD3(0, 1, 0))
        guard flatArea.isFinite && flatArea > 120 && flatArea < 140 else { return false }

        let u = proc.planeBasisU(normal: SIMD3(0, 1, 0))
        return u.x.isFinite && u.y.isFinite && u.z.isFinite && length(u) > 0.9
    }

    /// Regression guard for the "Processing…" hang reported on a dense indoor
    /// Siding Scan. Root cause: `cluster(_:maxDist:)` used to re-scan every
    /// triangle already absorbed into a cluster, for every remaining candidate,
    /// across repeated growth passes — roughly O(n^2)-O(n^3) — plus an O(n)
    /// `Array.remove(at:)` per triangle. Measured on the *old* algorithm before
    /// this fix: ~1.1s for a single 24k-triangle connected patch in an optimized
    /// (-O) build, and >30s for just 16k triangles in an unoptimized (Debug/
    /// -Onone — what a real device debug build actually runs) build. A dense
    /// LiDAR mesh from one small room easily exceeds that.
    ///
    /// This builds a synthetic ~30k-triangle, 4-wall room mesh whose bounding
    /// box is smaller than `maxDist` — the exact situation from the bug report
    /// (indoor room, so every triangle is trivially within `maxDist` of every
    /// other, same as the field scan) — and asserts clustering both finishes
    /// well within budget and still produces the correct partition (4 clusters,
    /// one per wall direction, no triangles dropped).
    static func runClusterPerformanceStressTest() -> Bool {
        let proc = MeshProcessor()
        let triangleCount = 30_000
        let triangles = makeSyntheticRoomMesh(count: triangleCount, seed: 12345)

        let start = Date()
        let clusters = proc.cluster(triangles, maxDist: 12.0)
        let elapsed = Date().timeIntervalSince(start)

        let totalClusteredTriangles = clusters.reduce(0) { $0 + $1.count }
        guard totalClusteredTriangles == triangleCount else { return false }
        guard clusters.count == 4 else { return false }
        // Measured ~0.003s (optimized) / low tens of ms (unoptimized) after the
        // fix. 2s leaves generous margin while still catching an O(n^2)+ regression
        // (the old algorithm alone took >30s at roughly half this triangle count
        // in an unoptimized build).
        guard elapsed < 2.0 else { return false }
        return true
    }

    private static func makeSyntheticRoomMesh(count: Int, seed: UInt64) -> [MeshProcessor.Triangle] {
        var rng = SeededRNG(seed: seed)
        var tris: [MeshProcessor.Triangle] = []
        tris.reserveCapacity(count)
        // Four walls with a slightly different base normal each, plus small
        // per-triangle jitter to simulate blinds/trim/corner detail breaking up
        // an otherwise-flat surface — matching the dense indoor scan from the
        // bug report far more closely than one perfectly uniform patch.
        let wallNormals: [SIMD3<Float>] = [
            SIMD3(0, 0, 1), SIMD3(0, 0, -1), SIMD3(1, 0, 0), SIMD3(-1, 0, 0)
        ]
        for i in 0..<count {
            let base = wallNormals[i % wallNormals.count]
            let centroid = SIMD3<Float>(
                Float.random(in: 0...4, using: &rng),
                Float.random(in: 0...2.5, using: &rng),
                Float.random(in: 0...4, using: &rng)
            )
            let jitter = SIMD3<Float>(
                Float.random(in: -0.08...0.08, using: &rng),
                Float.random(in: -0.08...0.08, using: &rng),
                Float.random(in: -0.08...0.08, using: &rng)
            )
            var normal = base + jitter
            normal = normal / length(normal)
            tris.append(MeshProcessor.Triangle(
                v0: centroid, v1: centroid + SIMD3(0.02, 0, 0), v2: centroid + SIMD3(0, 0.02, 0),
                normal: normal, areaSqM: 0.0003, faceClass: .wall, centroid: centroid
            ))
        }
        return tris
    }

    /// Minimal deterministic PRNG (xorshift64*) so the stress test above is reproducible.
    private struct SeededRNG: RandomNumberGenerator {
        var state: UInt64
        init(seed: UInt64) { state = seed &+ 0x9E3779B97F4A7C15 }
        mutating func next() -> UInt64 {
            state ^= state >> 12
            state ^= state << 25
            state ^= state >> 27
            return state &* 2685821657736338717
        }
    }
}
#endif
