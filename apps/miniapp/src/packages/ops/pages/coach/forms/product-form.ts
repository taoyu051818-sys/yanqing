import { ref } from "vue";

export function useTrainingProductForm() {
  const productCode = ref("");
  const productName = ref("");
  const productAudienceIndex = ref(0);
  const productTotalSessions = ref("12");
  const productValidityDays = ref("120");
  const productPriceYuan = ref("1280");
  const productReason = ref("");
  const audienceOptions = [
    { label: "成人", value: "ADULT" },
    { label: "青少年", value: "YOUTH" },
  ];
  const editingProductId = ref("");
  const editProductName = ref("");
  const editProductTotalSessions = ref("");
  const editProductValidityDays = ref("");
  const editProductPriceYuan = ref("");
  const editProductReason = ref("");
  return {
    productCode,
    productName,
    productAudienceIndex,
    productTotalSessions,
    productValidityDays,
    productPriceYuan,
    productReason,
    audienceOptions,
    editingProductId,
    editProductName,
    editProductTotalSessions,
    editProductValidityDays,
    editProductPriceYuan,
    editProductReason,
  };
}
