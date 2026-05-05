export interface Product {
  readonly id: string;
  readonly name: string;
  readonly image: string;
  readonly price: string;
  readonly brand: string;
  readonly url: string;
  readonly quantity: number;
  readonly availability: string;
  readonly category: string;
  readonly variant: string;
  readonly variantId: string;
  readonly projectId: string;
  readonly designAssetUrl: string;
}

export const PRODUCT: Product = {
  id: '2011084-base',
  name: 'Cricut Maker® 4',
  image: 'https://cricut.com/dw/image/v2/BHBM_PRD/on/demandware.static/-/Sites-cricut-master-catalog/default/dwc0a445f4/Maker4/Maker4_Updates/1_Hero_2011084_Maker4_Seashell.jpg?sw=600&q=65',
  price: '399.00',
  brand: 'cricut',
  url: 'https://cricut.com/en-us/cutting-machines/cricut-maker/cricut-maker-4/cricut-maker-4/2011084.html',
  quantity: 1,
  availability: 'InStock',
  category: 'machines_cricut-maker-machines',
  variant: 'Machine Only',
  variantId: '2011084',
  projectId: 'bridge-poc-project',
  designAssetUrl: 'https://cricut.com/dw/image/v2/BHBM_PRD/on/demandware.static/-/Sites-cricut-master-catalog/default/dwc0a445f4/Maker4/Maker4_Updates/1_Hero_2011084_Maker4_Seashell.jpg?sw=600&q=65',
};