@{
    ExcludeRules = @(
        'PSAvoidUsingWriteHost'
    )
    Rules = @{
        PSAvoidUsingConvertToSecureStringWithPlainText = @{
            Enable = $true
        }
        PSUseApprovedVerbs = @{
            Enable = $true
        }
        PSUseDeclaredVarsMoreThanAssignments = @{
            Enable = $true
        }
    }
}
