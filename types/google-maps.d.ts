// Google Maps API type declarations
declare namespace google {
  namespace maps {
    class Map {
      constructor(element: HTMLElement, options?: MapOptions)
      setCenter(latLng: LatLngLiteral): void
      setZoom(zoom: number): void
      panTo(latLng: LatLngLiteral): void
      addListener(event: string, handler: (e?: MapMouseEvent) => void): MapsEventListener
    }

    class Marker {
      constructor(options?: MarkerOptions)
      setPosition(latLng: LatLngLiteral): void
      setMap(map: Map | null): void
      addListener(event: string, handler: () => void): MapsEventListener
    }

    class Geocoder {
      geocode(
        request: GeocoderRequest,
        callback: (results: GeocoderResult[] | null, status: GeocoderStatus) => void
      ): void
    }

    class Point {
      constructor(x: number, y: number)
      x: number
      y: number
    }

    interface MapOptions {
      center?: LatLngLiteral
      zoom?: number
      disableDefaultUI?: boolean
      zoomControl?: boolean
      mapTypeControl?: boolean
      streetViewControl?: boolean
      fullscreenControl?: boolean
      styles?: MapTypeStyle[]
    }

    interface MarkerOptions {
      position?: LatLngLiteral
      map?: Map
      icon?: string | Icon | Symbol
      title?: string
      zIndex?: number
    }

    interface Icon {
      url?: string
      path?: string | SymbolPath
      scale?: number
      fillColor?: string
      fillOpacity?: number
      strokeColor?: string
      strokeWeight?: number
      anchor?: Point
    }

    interface Symbol {
      path: string | SymbolPath
      scale?: number
      fillColor?: string
      fillOpacity?: number
      strokeColor?: string
      strokeWeight?: number
      anchor?: Point
    }

    interface LatLngLiteral {
      lat: number
      lng: number
    }

    interface MapMouseEvent {
      latLng?: {
        lat(): number
        lng(): number
      }
    }

    interface MapsEventListener {
      remove(): void
    }

    interface GeocoderRequest {
      location?: LatLngLiteral
      address?: string
    }

    interface GeocoderResult {
      formatted_address: string
      geometry: {
        location: {
          lat(): number
          lng(): number
        }
      }
    }

    type GeocoderStatus = 'OK' | 'ZERO_RESULTS' | 'OVER_QUERY_LIMIT' | 'REQUEST_DENIED' | 'INVALID_REQUEST' | 'UNKNOWN_ERROR'

    interface MapTypeStyle {
      featureType?: string
      elementType?: string
      stylers?: { [key: string]: string | number | boolean }[]
    }

    enum SymbolPath {
      CIRCLE = 0,
      FORWARD_CLOSED_ARROW = 1,
      FORWARD_OPEN_ARROW = 2,
      BACKWARD_CLOSED_ARROW = 3,
      BACKWARD_OPEN_ARROW = 4,
    }
  }
}
