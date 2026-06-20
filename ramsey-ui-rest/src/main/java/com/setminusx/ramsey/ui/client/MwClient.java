package com.setminusx.ramsey.ui.client;

import com.setminusx.ramsey.ui.config.RamseyProperties;
import com.setminusx.ramsey.ui.model.CampaignDto;
import com.setminusx.ramsey.ui.model.ProgressionPointDto;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.util.List;

@Component
public class MwClient {

    private final RestClient restClient;

    public MwClient(RestClient.Builder builder, RamseyProperties props) {
        this.restClient = builder.baseUrl(props.apiBaseUrl()).build();
    }

    public List<CampaignDto> getCampaigns() {
        List<CampaignDto> body = restClient.get()
                .uri("/api/ramsey/campaigns")
                .retrieve()
                .body(new ParameterizedTypeReference<>() {});
        return body != null ? body : List.of();
    }

    public List<ProgressionPointDto> getProgression(int campaignId) {
        List<ProgressionPointDto> body = restClient.get()
                .uri("/api/ramsey/campaigns/{id}/progression", campaignId)
                .retrieve()
                .body(new ParameterizedTypeReference<>() {});
        return body != null ? body : List.of();
    }
}
