


function formatCurrency(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount)
}


function formatDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(date))
}


function formatDateTime(date) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date))
}


function isExpired(date) {
  return new Date(date) < new Date()
}


function getStatusBadge(status) {
  const badges = {
    pending: "badge-warning",
    processing: "badge-info",
    approved: "badge-success",
    completed: "badge-success",
    ready: "badge-success",
    rejected: "badge-danger",
    cancelled: "badge-danger",
    paid: "badge-success",
    refunded: "badge-danger",
  }
  return badges[status] || "badge-secondary"
}


function calculatePercentage(value, total) {
  if (total === 0) return 0
  return ((value / total) * 100).toFixed(2)
}

module.exports = {
  formatCurrency,
  formatDate,
  formatDateTime,
  isExpired,
  getStatusBadge,
  calculatePercentage,
}
