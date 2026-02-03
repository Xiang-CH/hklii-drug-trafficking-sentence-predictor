export const districtToSubDistricts: Record<string, Array<string>> = {
  // Hong Kong Island
  'Central and Western': [
    'Kennedy Town',
    'Shek Tong Tsui',
    'Sai Ying Pun',
    'Sheung Wan',
    'Central',
    'Admiralty',
    'Mid-Levels',
    'Peak',
  ],
  'Wan Chai': [
    'Wan Chai',
    'Causeway Bay',
    'Happy Valley',
    'Tai Hang',
    'So Kon Po',
    "Jardine's Lookout",
  ],
  Eastern: [
    'Tin Hau',
    'Braemar Hill',
    'North Point',
    'Quarry Bay',
    'Sai Wan Ho',
    'Shau Kei Wan',
    'Chai Wan',
    'Siu Sai Wan',
  ],
  Southern: [
    'Pok Fu Lam',
    'Aberdeen',
    'Ap Lei Chau',
    'Wong Chuk Hang',
    'Shouson Hill',
    'Repulse Bay',
    'Chung Hom Kok',
    'Stanley',
    'Tai Tam',
    'Shek O',
  ],
  // Kowloon
  'Yau Tsim Mong': [
    'Tsim Sha Tsui',
    'Yau Ma Tei',
    'West Kowloon Reclamation',
    "King's Park",
    'Mong Kok',
    'Tai Kok Tsui',
  ],
  'Sham Shui Po': [
    'Mei Foo',
    'Lai Chi Kok',
    'Cheung Sha Wan',
    'Sham Shui Po',
    'Shek Kip Mei',
    'Yau Yat Tsuen',
    'Tai Wo Ping',
    'Stonecutters Island',
  ],
  'Kowloon City': [
    'Hung Hom',
    'To Kwa Wan',
    'Ma Tau Kok',
    'Ma Tau Wai',
    'Kai Tak',
    'Kowloon City',
    'Ho Man Tin',
    'Kowloon Tong',
    'Beacon Hill',
  ],
  'Wong Tai Sin': [
    'San Po Kong',
    'Wong Tai Sin',
    'Tung Tau',
    'Wang Tau Hom',
    'Lok Fu',
    'Diamond Hill',
    'Tsz Wan Shan',
    'Ngau Chi Wan',
  ],
  'Kwun Tong': [
    'Ping Shek',
    'Kowloon Bay',
    'Ngau Tau Kok',
    'Jordan Valley',
    'Kwun Tong',
    'Sau Mau Ping',
    'Lam Tin',
    'Yau Tong',
    'Lei Yue Mun',
  ],
  // New Territories
  'Kwai Tsing': ['Kwai Chung', 'Tsing Yi'],
  'Tsuen Wan': [
    'Tsuen Wan',
    'Lei Muk Shue',
    'Ting Kau',
    'Sham Tseng',
    'Tsing Lung Tau',
    'Ma Wan',
    'Sunny Bay',
  ],
  'Tuen Mun': ['Tai Lam Chung', 'So Kwun Wat', 'Tuen Mun', 'Lam Tei'],
  'Yuen Long': [
    'Hung Shui Kiu',
    'Ha Tsuen',
    'Lau Fau Shan',
    'Tin Shui Wai',
    'Yuen Long',
    'San Tin',
    'Lok Ma Chau',
    'Kam Tin',
    'Shek Kong',
    'Pat Heung',
  ],
  North: [
    'Fanling',
    'Luen Wo Hui',
    'Sheung Shui',
    'Shek Wu Hui',
    'Sha Tau Kok',
    'Luk Keng',
    'Wu Kau Tang',
  ],
  'Tai Po': [
    'Tai Po Market',
    'Tai Po',
    'Tai Po Kau',
    'Tai Mei Tuk',
    'Shuen Wan',
    'Cheung Muk Tau',
    'Kei Ling Ha',
  ],
  'Sha Tin': [
    'Tai Wai',
    'Sha Tin',
    'Fo Tan',
    'Ma Liu Shui',
    'Wu Kai Sha',
    'Ma On Shan',
  ],
  'Sai Kung': [
    'Clear Water Bay',
    'Sai Kung',
    'Tai Mong Tsai',
    'Tseung Kwan O',
    'Hang Hau',
    'Tiu Keng Leng',
    'Ma Yau Tong',
  ],
  Islands: [
    'Cheung Chau',
    'Peng Chau',
    'Lantau Island',
    'Tung Chung',
    'Lamma Island',
  ],
}

export const districts = Object.keys(districtToSubDistricts)
export const subDistricts = Object.values(districtToSubDistricts).flat()

const subDistrictToDistrict: Record<string, string> = {}
for (const [district, subDistricts2] of Object.entries(
  districtToSubDistricts,
)) {
  for (const subDistrict of subDistricts2) {
    subDistrictToDistrict[subDistrict] = district
  }
}

export function getDistrictBySubDistrict(subDistrict: string): string | null {
  return subDistrictToDistrict[subDistrict] || null
}

// Group districts by region
export const regionGroups = {
  'Hong Kong Island': [
    'Central and Western',
    'Wan Chai',
    'Eastern',
    'Southern',
  ],
  Kowloon: [
    'Yau Tsim Mong',
    'Sham Shui Po',
    'Kowloon City',
    'Wong Tai Sin',
    'Kwun Tong',
  ],
  'New Territories': [
    'Kwai Tsing',
    'Tsuen Wan',
    'Tuen Mun',
    'Yuen Long',
    'North',
    'Tai Po',
    'Sha Tin',
    'Sai Kung',
    'Islands',
  ],
}
