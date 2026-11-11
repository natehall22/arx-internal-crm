/**
 * Best-guess time zone of a US phone number from its area code (client-safe, pure). Only codes that sit wholly in one zone
 * are listed; a split code (e.g. 850) or an unknown one answers null, and the sender then uses only the company's zone.
 * It is a guess (people move, numbers port): the sender applies the STRICTER of the company's and this zone.
 */
const EASTERN = '201 202 203 207 212 215 216 220 234 239 240 248 267 301 302 305 313 315 321 330 332 336 339 347 351 352 365 386 401 404 407 410 412 413 419 434 440 443 470 475 478 484 508 513 516 517 518 540 551 561 567 570 571 585 586 603 607 609 610 614 617 631 646 667 678 681 689 703 704 706 716 717 718 724 727 732 740 754 757 762 770 772 774 781 786 802 803 804 810 813 828 845 848 856 857 860 862 863 864 878 904 908 910 912 914 917 919 929 937 941 947 954 959 973 978 980 984 989'
const CENTRAL = '205 210 214 217 218 219 224 225 228 254 256 262 281 309 312 314 316 318 319 320 331 334 346 361 402 405 409 414 417 430 469 479 501 504 507 512 515 531 563 573 580 601 608 612 615 618 630 636 641 651 662 708 712 713 715 731 737 763 769 773 779 815 816 817 830 832 847 870 872 901 913 918 920 931 936 940 952 956 972 979 985'
const MOUNTAIN = '208 303 307 385 406 435 505 575 719 720 801 970'
const ARIZONA = '480 520 602 623 928'
const PACIFIC = '206 209 213 253 279 310 323 341 360 408 415 424 425 442 503 510 530 541 559 562 619 626 628 650 657 661 669 702 707 714 725 747 760 775 805 818 831 840 858 909 916 925 949 951 971'

const MAP = new Map<string, string>()
for (const [codes, zone] of [
  [EASTERN, 'America/New_York'],
  [CENTRAL, 'America/Chicago'],
  [MOUNTAIN, 'America/Denver'],
  [ARIZONA, 'America/Phoenix'],
  [PACIFIC, 'America/Los_Angeles'],
  ['907', 'America/Anchorage'],
  ['808', 'Pacific/Honolulu'],
] as const) {
  for (const c of codes.split(' ')) MAP.set(c, zone)
}

/** "+13105550100" → "America/Los_Angeles"; null when the area code is split, unknown or the number is not US. */
export function areaCodeTimeZone(e164: string | null | undefined): string | null {
  const m = /^\+1([2-9]\d{2})[2-9]\d{6}$/.exec(e164 ?? '')
  return m ? (MAP.get(m[1]) ?? null) : null
}
