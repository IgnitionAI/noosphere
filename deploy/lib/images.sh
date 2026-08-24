#!/usr/bin/env bash

# Shared image reference resolution for Compose, releases and diagnostics.
# The caller decides whether to export the resulting variables.

noosphere_validate_image_coordinates() {
  local namespace="${IMAGE_NAMESPACE:-ignitionai}"
  local prefix="${IMAGE_PREFIX:-noosphere}"
  local registry="${IMAGE_REGISTRY:-ghcr.io}"

  if [[ ! "$namespace" =~ ^[a-z0-9]+([._-][a-z0-9]+)*$ ]]; then
    echo "IMAGE_NAMESPACE must be lowercase and container-registry safe" >&2
    return 1
  fi
  if [[ ! "$prefix" =~ ^[a-z0-9]+([._-][a-z0-9]+)*$ ]]; then
    echo "IMAGE_PREFIX must be lowercase and container-registry safe" >&2
    return 1
  fi
  if [[ -z "$registry" || "$registry" == */ || "$registry" == *://* ]]; then
    echo "IMAGE_REGISTRY must be a registry host without a scheme or trailing slash" >&2
    return 1
  fi
}

noosphere_resolve_images() {
  : "${APP_VERSION:?APP_VERSION is required to resolve application images}"
  IMAGE_REGISTRY="${IMAGE_REGISTRY:-ghcr.io}"
  IMAGE_NAMESPACE="${IMAGE_NAMESPACE:-ignitionai}"
  IMAGE_PREFIX="${IMAGE_PREFIX:-noosphere}"
  noosphere_validate_image_coordinates

  BACKEND_IMAGE="${BACKEND_IMAGE:-${IMAGE_REGISTRY}/${IMAGE_NAMESPACE}/${IMAGE_PREFIX}-backend:${APP_VERSION}}"
  WEB_IMAGE="${WEB_IMAGE:-${IMAGE_REGISTRY}/${IMAGE_NAMESPACE}/${IMAGE_PREFIX}-web:${APP_VERSION}}"
  CRAWLER_IMAGE="${CRAWLER_IMAGE:-${IMAGE_REGISTRY}/${IMAGE_NAMESPACE}/${IMAGE_PREFIX}-crawler:${APP_VERSION}}"
}

noosphere_export_images() {
  noosphere_resolve_images
  export IMAGE_REGISTRY IMAGE_NAMESPACE IMAGE_PREFIX
  export BACKEND_IMAGE WEB_IMAGE CRAWLER_IMAGE
}
